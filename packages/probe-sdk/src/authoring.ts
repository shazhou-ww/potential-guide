import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  files,
  outputDirectory,
  portable,
  readReferences,
  safeDirectory,
  safeFile,
  validateReference,
  yaml,
} from "@potential-guide/check-sdk/authoring";
import { createCheckResultSchema } from "@potential-guide/check-sdk/contracts";
import {
  type IpfsClient,
  openContent,
  readContentTree,
  validateContentCar,
} from "@potential-guide/ipfs-content";
import {
  canonical,
  json,
  normalizeTaskText,
  readTaskBundle,
  selectTaskBinary,
} from "@silvermoon-work/task-protocol";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { stringify } from "yaml";
import { createProbeResultSchema } from "./contracts.js";
import {
  type CheckDefinition,
  checksSchema,
  identifier,
  levelsSchema,
  type ObjectiveDefinition,
  objectiveSchemaUri,
  type ProbeDefinitions,
  readCheckDefinition,
  readObjective,
  validateComposition,
} from "./model.js";
import type { PublicationResolution } from "./publication.js";

export { objectiveSchema, objectiveSchemaUri } from "./model.js";

const path = Type.String({ minLength: 1 });
export const probeBuildSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    kind: identifier,
    source: Type.Object(
      { root: path, entry: path, contract: path },
      { additionalProperties: false },
    ),
    languages: Type.Array(Type.String(), { minItems: 1, uniqueItems: true, maxItems: 32 }),
    referenceRoot: path,
    bundles: Type.Record(
      identifier,
      Type.Object(
        {
          source: Type.Union([
            Type.Object({ kind: Type.Literal("ipfs"), cid: path }, { additionalProperties: false }),
            Type.Object(
              { kind: Type.Literal("publication"), url: path },
              { additionalProperties: false },
            ),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
    checks: checksSchema,
    levels: levelsSchema,
    resources: Type.Optional(
      Type.Array(Type.Object({ from: path, to: path }, { additionalProperties: false }), {
        maxItems: 256,
      }),
    ),
    binary: Type.Optional(Type.Array(path, { maxItems: 256 })),
  },
  { additionalProperties: false },
);
export type ProbeBuild = Static<typeof probeBuildSchema>;
export interface ProbeLock {
  version: 1;
  authorDigest: string;
  dependencies: Record<
    string,
    { source: ProbeBuild["bundles"][string]["source"]; cid: string; revision?: number }
  >;
  toolchain: { node: string; unixfs: string; dependencyLock: string };
}
export interface PreparedProbe {
  kind: string;
  staging: string;
  buildFile: string;
  resources: ReadonlyMap<string, Buffer>;
  binary: readonly string[];
  objective: ObjectiveDefinition;
  definitions: ProbeDefinitions;
  lock: ProbeLock;
}
export interface PrepareProbeOptions {
  client: IpfsClient;
  resolvePublication?: (url: string, signal: AbortSignal) => Promise<PublicationResolution>;
  signal?: AbortSignal;
  timeoutMs?: number;
  lock?: ProbeLock;
  mode?: "update" | "locked";
}
const decode = (bytes: Uint8Array) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
const equal = (a: unknown, b: unknown) => canonical(json(a)) === canonical(json(b));

async function dependencyLock(root: string): Promise<string> {
  for (let directory = root; ; directory = dirname(directory)) {
    for (const name of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]) {
      try {
        const bytes = await readFile(join(directory, name));
        if (bytes.length > 16 * 1024 * 1024) throw new Error("Dependency lock budget exceeded.");
        return createHash("sha256").update(bytes).digest("hex");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
    if (dirname(directory) === directory)
      throw new Error("Probe preparation requires a dependency lockfile.");
  }
}

export function verifyCheckDefinition(contents: ReadonlyMap<string, Uint8Array>): CheckDefinition {
  const { resolved } = readTaskBundle(contents);
  const bytes = contents.get("resources/check.json");
  if (!bytes) throw new Error("Child is not a Check Task Bundle.");
  const definition = readCheckDefinition(decode(bytes));
  const expected = JSON.parse(
    JSON.stringify(createCheckResultSchema(definition.problemCodes, definition.languages)),
  ) as Record<string, unknown>;
  const actual = { ...(resolved.resultSchema as Record<string, unknown>) };
  delete actual.$id;
  if (
    !equal(actual, expected) ||
    !(resolved.messageSchema === false || equal(resolved.messageSchema, { not: {} }))
  )
    throw new Error("Child Check result/message contract differs from its definition.");
  for (const refs of Object.values(definition.references))
    for (const path of [refs.check, ...Object.values(refs.problems)]) {
      const page = contents.get(path);
      if (!page) throw new Error(`Missing child Reference: ${path}`);
      validateReference(page, path);
    }
  return definition;
}

/** Snapshot all author and dependency inputs; no compilation, publication or pinning. */
export async function prepareProbe(
  buildFile: string,
  options: PrepareProbeOptions,
): Promise<PreparedProbe> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600_000)
    throw new Error("Invalid prepare timeout.");
  const signal = AbortSignal.any([
    AbortSignal.timeout(timeoutMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  const root = dirname(resolve(buildFile));
  const authorBytes = await readFile(buildFile);
  const config = yaml(authorBytes.toString("utf8"), buildFile);
  if (!Value.Check(probeBuildSchema, config))
    throw new Error(
      `Invalid Probe Build YAML: ${[...Value.Errors(probeBuildSchema, config)].map((e) => `${e.path} ${e.message}`).join("; ")}`,
    );
  validateComposition({
    ...config,
    bundles: Object.fromEntries(
      Object.keys(config.bundles).map((name) => [name, { path: "", cid: "" }]),
    ),
  });
  if (Object.keys(config.bundles).length > 32 || Object.keys(config.checks).length > 128)
    throw new Error("Probe composition budget exceeded.");
  for (const path of [config.referenceRoot, config.source.root]) {
    portable(path);
    if (path.split("/")[0] === "dist") throw new Error("Author inputs overlap generated dist.");
    await safeDirectory(root, path);
  }
  const source = new Map<string, Buffer>();
  for (const path of await files(join(root, config.source.root))) {
    const full = `${config.source.root}/${path}`;
    source.set(full, await safeFile(root, full));
  }
  for (const entry of [config.source.entry, config.source.contract])
    if (!source.has(entry)) throw new Error(`Source not in source root: ${entry}`);
  const bundles: ObjectiveDefinition["bundles"] = {};
  const childDefinitions: Record<string, CheckDefinition> = {};
  const children = new Map<string, Buffer>();
  const childBinary: string[] = [];
  const dependencies: ProbeLock["dependencies"] = {};
  const resolutions = new Map<string, PublicationResolution>();
  const snapshots = new Map<string, Awaited<ReturnType<typeof readContentTree>>>();
  let dependencyBytes = 0;
  let dependencyFiles = 0;
  for (const [name, binding] of Object.entries(config.bundles)) {
    signal.throwIfAborted();
    const source = binding.source;
    let cid: string;
    let revision: number | undefined;
    if (options.mode === "locked") {
      const locked = options.lock?.dependencies[name];
      if (!locked || !equal(locked.source, source))
        throw new Error(`Missing or stale dependency lock: ${name}`);
      cid = locked.cid;
      revision = locked.revision;
    } else if (source.kind === "ipfs") cid = source.cid;
    else {
      let resolution = resolutions.get(source.url);
      if (!resolution) {
        if (!options.resolvePublication)
          throw new Error("Publication resolution requires an authorized adapter.");
        resolution = await options.resolvePublication(source.url, signal);
        resolutions.set(source.url, resolution);
      }
      cid = resolution.cid;
      revision = resolution.revision;
      if (!Number.isSafeInteger(revision) || revision < 1)
        throw new Error("Invalid publication revision.");
    }
    let snapshot = snapshots.get(cid);
    if (!snapshot) {
      snapshot = await readContentTree(options.client, cid, { signal });
      snapshots.set(cid, snapshot);
    }
    childDefinitions[name] = verifyCheckDefinition(snapshot.files);
    const prefix = `resources/checks/${name}`;
    bundles[name] = { path: prefix, cid: snapshot.cid };
    dependencies[name] = {
      source,
      cid: snapshot.cid,
      ...(revision !== undefined ? { revision } : {}),
    };
    for (const [path, bytes] of snapshot.files) {
      dependencyBytes += bytes.byteLength;
      dependencyFiles++;
      if (dependencyBytes > 64 * 1024 * 1024 || dependencyFiles > 256)
        throw new Error("Probe dependency snapshot budget exceeded.");
      children.set(`${prefix}/${path}`, Buffer.from(bytes));
    }
    childBinary.push(
      ...readTaskBundle(snapshot.files).declaration.binary.map((path) => `${prefix}/${path}`),
    );
  }
  const optional = Object.entries(config.checks).flatMap(([ref, check]) => [
    `checks/${ref}/check.md`,
    ...childDefinitions[check.bundle]!.problemCodes.map(
      (code) => `checks/${ref}/problems/${code}.md`,
    ),
  ]);
  const resources = await readReferences(
    root,
    config.referenceRoot,
    config.languages,
    [
      "objective.md",
      ...config.levels.map((level) => `levels/${level.id}.md`),
      "levels/terminal.md",
    ],
    optional,
  );
  const references: ObjectiveDefinition["references"] = {};
  for (const language of config.languages) {
    const base = `resources/references/${language}`;
    const checks: ObjectiveDefinition["references"][string]["checks"] = {};
    for (const [ref, check] of Object.entries(config.checks)) {
      const child = childDefinitions[check.bundle]!;
      const own = `${base}/checks/${ref}`;
      const problems: Record<string, string> = {};
      for (const code of child.problemCodes) {
        const path = `${own}/problems/${code}.md`;
        if (resources.has(path)) problems[code] = path;
        else if (!child.references[language]?.problems[code])
          throw new Error(`Missing effective ${language} ${ref}/${code} page.`);
      }
      const path = `${own}/check.md`;
      if (!resources.has(path) && !child.references[language]?.check)
        throw new Error(`Missing effective ${language} ${ref} page.`);
      if (resources.has(path) || Object.keys(problems).length)
        checks[ref] = { ...(resources.has(path) ? { check: path } : {}), problems };
    }
    references[language] = {
      objective: `${base}/objective.md`,
      levels: Object.fromEntries(
        [...config.levels.map((level) => level.id), "terminal"].map((id) => [
          id,
          `${base}/levels/${id}.md`,
        ]),
      ),
      checks,
    };
  }
  for (const resource of config.resources ?? []) {
    const destination = portable(resource.to);
    if (
      !destination.startsWith("resources/") ||
      destination.startsWith("resources/checks/") ||
      destination.startsWith("resources/references/") ||
      destination === "resources/objective.json" ||
      resources.has(destination)
    )
      throw new Error(`Invalid extra resource: ${destination}`);
    resources.set(destination, await safeFile(root, resource.from));
  }
  const ownBinary = selectTaskBinary(
    [
      "task.yaml",
      "worker.cjs",
      ...resources.keys(),
      "resources/objective.json",
      ...children.keys(),
    ],
    config.binary ?? [],
  );
  if (
    ownBinary.some(
      (path) => path.startsWith("resources/checks/") || path === "resources/objective.json",
    )
  )
    throw new Error("Parent binary rules cannot select child content or generated Objective.");
  const objective = readObjective({
    $schema: objectiveSchemaUri,
    kind: config.kind,
    languages: config.languages,
    bundles,
    checks: config.checks,
    levels: config.levels,
    references,
  });
  const definitions: ProbeDefinitions = {
    languages: config.languages,
    levels: config.levels,
    problemCodes: Object.fromEntries(
      Object.entries(config.checks).map(([ref, check]) => [
        ref,
        childDefinitions[check.bundle]!.problemCodes,
      ]),
    ),
  };
  const digest = createHash("sha256").update(authorBytes);
  for (const [path, bytes] of [...source, ...resources].sort(([a], [b]) => a.localeCompare(b)))
    digest.update(JSON.stringify(path)).update(createHash("sha256").update(bytes).digest());
  const lock: ProbeLock = {
    version: 1,
    authorDigest: digest.digest("hex"),
    dependencies,
    toolchain: {
      node: process.version,
      unixfs: "cidv1-raw-fixed262144-balanced174-unsharded-v1",
      dependencyLock: await dependencyLock(root),
    },
  };
  if (options.mode === "locked" && !equal(options.lock, lock))
    throw new Error("Author/toolchain lock mismatch.");
  resources.set("resources/objective.json", Buffer.from(`${JSON.stringify(objective, null, 2)}\n`));
  for (const [path, bytes] of children) resources.set(path, bytes);
  const binary = [...ownBinary, ...childBinary].sort();
  for (const [path, bytes] of resources)
    if (!binary.includes(path) && !path.startsWith("resources/checks/"))
      resources.set(path, Buffer.from(normalizeTaskText(bytes, path)));
  const folded = new Set<string>();
  let total = 0;
  for (const [path, bytes] of [...source, ...resources]) {
    portable(path);
    if (folded.has(path.toLowerCase())) throw new Error(`Ambiguous resource path: ${path}`);
    folded.add(path.toLowerCase());
    total += bytes.length;
  }
  if (resources.size > 256 || folded.size > 4096 || total > 64 * 1024 * 1024)
    throw new Error("Probe snapshot budget exceeded.");
  const definitionBase = `dist/definitions/${config.kind}`;
  const definitionJs = Buffer.from(
    `export const definitions = Object.freeze(${JSON.stringify(definitions)});\n`,
  );
  const definitionTypes = Buffer.from(
    `export declare const definitions: ${JSON.stringify(definitions)};\n`,
  );
  source.set(`${definitionBase}.js`, definitionJs);
  source.set(`${definitionBase}.d.ts`, definitionTypes);
  const snapshotId = createHash("sha256").update(JSON.stringify(lock)).digest("hex").slice(0, 24);
  const stagingRelative = `dist/staging/${config.kind}/${snapshotId}`;
  await outputDirectory(root, stagingRelative);
  await outputDirectory(root, "dist/definitions");
  const staging = join(root, stagingRelative);
  for (const [path, bytes] of [...source, ...resources]) {
    signal.throwIfAborted();
    await outputDirectory(staging, path.slice(0, path.lastIndexOf("/")));
    await writeFile(join(staging, path), bytes);
  }
  await writeFile(join(root, `${definitionBase}.js`), definitionJs);
  await writeFile(join(root, `${definitionBase}.d.ts`), definitionTypes);
  const generated = {
    $schema: "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task-build/v1.json",
    name: config.name,
    runtime: { minVersion: "22.13.0" },
    source: { entry: config.source.entry, contract: config.source.contract, mode: "explicit" },
    include: [...resources.keys()].map((path) => ({
      from: path,
      to: path.slice(0, path.lastIndexOf("/") + 1),
    })),
    outDirectory: "bundle",
    binary,
  };
  const output = join(staging, "task.build.yaml");
  await writeFile(output, stringify(generated));
  await writeFile(join(staging, "prepare.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  return {
    kind: config.kind,
    staging,
    buildFile: output,
    resources,
    binary,
    objective,
    definitions,
    lock,
  };
}

/** Acceptance requires the final CAR, including actual linked child roots, not just file equality. */
export async function verifyProbeResources(
  prepared: PreparedProbe,
  artifact: { files: ReadonlyMap<string, Uint8Array>; archive?: Uint8Array; cid: string },
): Promise<void> {
  if (!artifact.archive) throw new Error("Probe acceptance requires the final CAR.");
  const { blockstore } = await validateContentCar(artifact.archive, artifact.cid);
  const client: IpfsClient = {
    block: {
      get: async (cid) => {
        const { CID } = await import("multiformats/cid");
        const parts: Uint8Array[] = [];
        for await (const part of blockstore.get(CID.parse(cid))) parts.push(part);
        return Buffer.concat(parts);
      },
    },
  };
  const tree = await readContentTree(client, artifact.cid, {
    signal: new AbortController().signal,
  });
  if (
    !equal([...tree.files.keys()].sort(), [...artifact.files.keys()].sort()) ||
    [...tree.files].some(
      ([path, bytes]) => !Buffer.from(bytes).equals(Buffer.from(artifact.files.get(path) ?? [])),
    )
  )
    throw new Error("Supplied files differ from final CAR.");
  const actual = [...artifact.files.keys()].filter((path) => path.startsWith("resources/")).sort();
  if (!equal(actual, [...prepared.resources.keys()].sort()))
    throw new Error("Probe CAR resource selection mismatch.");
  const { declaration, resolved } = readTaskBundle(artifact.files);
  if (!equal(declaration.binary, prepared.binary))
    throw new Error("Probe CAR binary selection mismatch.");
  if (
    !equal(
      resolved.resultSchema,
      JSON.parse(JSON.stringify(createProbeResultSchema(prepared.definitions))),
    ) ||
    !(resolved.messageSchema === false || equal(resolved.messageSchema, { not: {} }))
  )
    throw new Error("Probe contract differs from prepared definitions.");
  for (const [path, bytes] of prepared.resources)
    if (!Buffer.from(artifact.files.get(path) ?? []).equals(bytes))
      throw new Error(`Probe CAR resource bytes differ: ${path}`);
  for (const bundle of Object.values(prepared.objective.bundles)) {
    const node = await openContent(client, `${artifact.cid}/${bundle.path}`, {
      signal: new AbortController().signal,
    });
    if (node.type !== "directory" || node.cid.toString() !== bundle.cid)
      throw new Error("Probe child root identity changed.");
  }
}
