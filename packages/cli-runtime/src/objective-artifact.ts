import { createHash } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Ajv } from "ajv";
import {
  type CheckArtifactSource,
  type PreparedCheckArtifact,
  prepareCheckArtifact,
  inspectCheckArtifact,
  readArtifactFiles,
  safePath,
} from "@potential-guide/check-artifacts";
import {
  createPrivateDirectory,
  createPrivateFile,
  ensurePrivateDirectory,
  hostDirectory,
  connectHost,
  type CheckClient,
  type ArtifactMetadata,
  TaskProtocolError,
} from "@potential-guide/checker-host";
import {
  type ArtifactObjectiveSource,
  compileSubjectProjection,
  createWorkerCheckProbe,
  createArtifactCheckProbe,
  type PilotRuntime,
  type PilotSpec,
  type ReferencePage,
  type RunEvidence,
  sameObjectiveSource,
} from "@potential-guide/objective-pilot";
import {
  immutable,
  isJsonValue,
  parseManifest,
  record,
  validateObjectiveArtifactDocument,
  validatePilotSource,
} from "@potential-guide/pilot-protocol";
import type { PilotSourceOptions } from "./pilot-source.js";

export const objectiveArtifactSchemaUri =
  "https://shazhou-ww.github.io/potential-guide/schemas/objective-artifact/v1.json";
export const objectiveArtifactDigestPrefix = "sha256-pguide-objective-v1:";
function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing prepared ${label}.`);
  return value;
}
export interface ObjectiveArtifactManifest {
  readonly $schema: typeof objectiveArtifactSchemaUri;
  readonly id: string;
  readonly subjectSchema: PilotSpec["manifest"]["subjectSchema"];
  readonly levels: PilotSpec["manifest"]["levels"];
  readonly defaultLanguage: string;
  readonly languages: PilotSpec["manifest"]["languages"];
  readonly checks: Readonly<
    Record<
      string,
      {
        readonly source: CheckArtifactSource;
        readonly subject: string;
      }
    >
  >;
  readonly dependencies: Readonly<
    Record<string, { readonly directory: string; readonly digest: string }>
  >;
  readonly references: Readonly<
    Record<
      string,
      Readonly<
        Record<
          string,
          {
            readonly path: string;
            readonly title: string;
            readonly description: string;
            readonly references?: readonly string[];
          }
        >
      >
    >
  >;
  readonly resources: readonly string[];
}
function pilotManifest(manifest: ObjectiveArtifactManifest): PilotSpec["manifest"] {
  return parseManifest(
    JSON.stringify({
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json",
      subjectSchema: manifest.subjectSchema,
      levels: manifest.levels,
      defaultLanguage: manifest.defaultLanguage,
      languages: manifest.languages,
    }),
  );
}
/** Inspect author-owned data without installing packages or executing JavaScript. */
export async function inspectObjectiveArtifact(directory: string) {
  const files = await readArtifactFiles(resolve(directory));
  const bytes = files.get("objective.json");
  if (!bytes || bytes.length > 16 * 1024) throw new Error("Missing or oversized objective.json.");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!validateObjectiveArtifactDocument(value))
    throw new Error(
      `Invalid Objective artifact manifest: ${JSON.stringify(validateObjectiveArtifactDocument.errors)}.`,
    );
  const manifest = value as ObjectiveArtifactManifest;
  pilotManifest(manifest);
  const used = new Set(manifest.levels.flatMap((level) => level.checks.map((check) => check.id)));
  if (
    used.size !== Object.keys(manifest.checks).length ||
    [...used].some((id) => !Object.hasOwn(manifest.checks, id))
  )
    throw new Error("Every Check reference must be declared and used.");
  for (const check of Object.values(manifest.checks))
    compileSubjectProjection(check.subject, { requireDefined: true });
  const declared = new Set(["objective.json"]);
  for (const [id, locales] of Object.entries(manifest.references)) {
    if (
      !/^(?:(?:system|levels|checks|pages)\/[a-z0-9-]+|checks\/[a-z0-9-]+\/problems\/[a-z0-9-]+|levels\/[a-z0-9-]+\/checks\/[a-z0-9-]+(?:\/problems\/[a-z0-9-]+)?)$/.test(
        id,
      ) ||
      Object.keys(locales).some((language) => !manifest.languages.includes(language))
    )
      throw new Error("Invalid Reference identity or locale.");
    for (const page of Object.values(locales)) declared.add(page.path);
  }
  for (const path of manifest.resources) declared.add(path);
  if (
    [...declared].some(
      (path) => !safePath(path) || (path !== "objective.json" && !path.startsWith("references/")),
    ) ||
    files.size !== declared.size ||
    [...declared].some((path) => !files.has(path))
  )
    throw new Error("Objective artifact has unsafe, missing or undeclared files.");
  const hash = createHash("sha256").update("pguide-objective\0v1\0");
  for (const [name, content] of [...files].sort(([a], [b]) =>
    Buffer.compare(Buffer.from(a), Buffer.from(b)),
  ))
    hash
      .update(JSON.stringify([name, content.length]))
      .update("\0")
      .update(content);
  return { manifest, files, digest: `${objectiveArtifactDigestPrefix}${hash.digest("hex")}` };
}
type Inspected = Awaited<ReturnType<typeof inspectObjectiveArtifact>>;
async function prepareData(
  directory: string,
  digest: string,
  cache: string,
  signal?: AbortSignal,
): Promise<Inspected & { directory: string }> {
  if (!/^sha256-pguide-objective-v1:[a-f0-9]{64}$/.test(digest))
    throw new Error("An exact Objective artifact digest is required.");
  await ensurePrivateDirectory(cache);
  const target = join(cache, digest.slice(objectiveArtifactDigestPrefix.length));
  async function verified() {
    await ensurePrivateDirectory(target);
    const result = await inspectObjectiveArtifact(target);
    if (result.digest !== digest) throw new Error("Objective cache content digest mismatch.");
    return { ...result, directory: target };
  }
  try {
    await lstat(target);
    return await verified();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      await lstat(target);
      throw new Error("Objective cache is incomplete.");
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code !== "ENOENT") throw missing;
    }
  }
  signal?.throwIfAborted();
  const artifact = await inspectObjectiveArtifact(directory);
  if (artifact.digest !== digest) throw new Error("Objective artifact content digest mismatch.");
  const staging = await createPrivateDirectory(cache, "objective-");
  try {
    for (const [name, bytes] of artifact.files) {
      signal?.throwIfAborted();
      const path = join(staging, ...name.split("/"));
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      if (name === "objective.json") {
        const metadata = await createPrivateDirectory(cache, "metadata-");
        try {
          await createPrivateFile(metadata, name, bytes.toString("utf8"));
          await rename(join(metadata, name), path);
        } finally {
          await rm(metadata, { recursive: true, force: true });
        }
      } else await writeFile(path, bytes, { flag: "wx", mode: 0o400 });
    }
    signal?.throwIfAborted();
    try {
      await rename(staging, target);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw error;
      await lstat(target);
    }
    return await verified();
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
/** A declaration-safe address carrying an exact digest, distinct from stable Objective identity. */
export function objectiveArtifactLocation(directory: string, digest: string): string {
  if (!/^sha256-pguide-objective-v1:[a-f0-9]{64}$/.test(digest))
    throw new Error("An exact Objective artifact digest is required.");
  const url = pathToFileURL(resolve(directory));
  url.searchParams.set("digest", digest);
  return url.href.replace(/^file:/, "artifact+file:");
}
export function parseObjectiveArtifactLocation(location: string): {
  directory: string;
  digest: string;
} {
  const url = new URL(location.replace(/^artifact\+file:/, "file:"));
  const digest = url.searchParams.get("digest");
  if (
    !location.startsWith("artifact+file:") ||
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams.keys()].join(",") !== "digest" ||
    digest === null ||
    !/^sha256-pguide-objective-v1:[a-f0-9]{64}$/.test(digest)
  )
    throw new Error("Artifact location requires a file URL and one exact digest.");
  url.search = "";
  return { directory: fileURLToPath(url), digest };
}
function referenceLocales(
  artifact: Inspected & { directory: string },
  checks: ReadonlyMap<string, BoundCheck>,
  checkContents: CheckContents,
) {
  const { manifest, digest } = artifact;
  const decode = (bytes: Buffer) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return Object.fromEntries(
    manifest.languages.map((language) => {
      const pages: Record<string, ReferencePage> = Object.create(null);
      const baseIds = new Set<string>();
      const overridden = new Set<string>();
      const owned = (
        id: string,
        title: string,
        path: string,
        ownerDigest: string,
        directory: string,
        content: string,
      ): ReferencePage => ({
        id,
        title,
        description: title,
        content,
        references: [],
        origin: { artifactDigest: ownerDigest, path },
        resourceBase: pathToFileURL(join(directory, ...path.split("/").slice(0, -1)) + sep).href,
      });
      for (const [ref, check] of checks) {
        const inherited = (id: string, path: string, title: string) => {
          const content = checkContents.get(check)?.get(path);
          if (!content) throw new Error("Missing prepared Check Reference.");
          if (check.kind === "local")
            return owned(
              id,
              title,
              path,
              check.digest,
              check.prepared.artifactDirectory,
              decode(content),
            );
          return {
            id,
            title,
            description: title,
            content: decode(content),
            references: [],
            origin: { artifactDigest: check.digest, path },
            resourceBase: `${check.client.address.endpoint}/v2/artifacts/${encodeURIComponent(check.digest)}/references/${path.split("/").slice(0, -1).join("/")}/`,
          };
        };
        const base = `pages/base-${ref}`;
        if (pages[base]) throw new Error("Ambiguous base Reference identity.");
        pages[base] = inherited(base, check.manifest.references.check, check.manifest.id);
        baseIds.add(base);
        pages[`checks/${ref}`] = { ...pages[base], id: `checks/${ref}` };
        for (const [problem, path] of Object.entries(check.manifest.references.problems)) {
          const baseProblem = `${base}-${problem}`;
          if (pages[baseProblem]) throw new Error("Ambiguous base Reference identity.");
          pages[baseProblem] = inherited(baseProblem, path, problem);
          baseIds.add(baseProblem);
          pages[`checks/${ref}/problems/${problem}`] = {
            ...pages[baseProblem],
            id: `checks/${ref}/problems/${problem}`,
          };
        }
        for (const level of manifest.levels) {
          const declared = level.checks.find((item) => item.id === ref);
          if (!declared) continue;
          const scoped = `levels/${level.id}/checks/${ref}`;
          pages[scoped] = { ...pages[base], id: scoped };
          for (const problem of declared.problems) {
            const id = `${scoped}/problems/${problem}`;
            const page = pages[`${base}-${problem}`];
            if (!page) throw new Error("Objective cannot declare problems absent from its Check.");
            pages[id] = { ...page, id };
          }
        }
      }
      const allowed = new Set([
        "system/overview",
        "system/404",
        "levels/initial",
        "levels/terminal",
        ...manifest.levels.map((level) => `levels/${level.id}`),
        ...Object.keys(pages),
      ]);
      for (const [id, locales] of Object.entries(manifest.references)) {
        if (
          (!allowed.has(id) && !/^pages\/[a-z0-9-]+$/.test(id)) ||
          baseIds.has(id) ||
          id.startsWith("pages/base-")
        )
          throw new Error("Unknown or reserved Reference override.");
        const page = locales[language] ?? locales[manifest.defaultLanguage];
        if (!page) {
          if (pages[id]) continue;
          throw new Error(`Reference has no language fallback: ${id}.`);
        }
        const content = artifact.files.get(page.path);
        if (!content?.length) throw new Error("Objective References must not be empty.");
        pages[id] = {
          ...owned(id, page.title, page.path, digest, artifact.directory, decode(content)),
          description: page.description,
          references: page.references ?? [],
        };
        overridden.add(id);
      }
      // A reference-scoped Check override applies at all its level occurrences unless explicitly overridden there.
      for (const level of manifest.levels)
        for (const check of level.checks) {
          const id = `levels/${level.id}/checks/${check.id}`;
          if (!overridden.has(id))
            pages[id] = { ...required(pages[`checks/${check.id}`], "Check Reference"), id };
          for (const problem of check.problems) {
            const scoped = `${id}/problems/${problem}`;
            if (!overridden.has(scoped))
              pages[scoped] = {
                ...required(pages[`checks/${check.id}/problems/${problem}`], "problem Reference"),
                id: scoped,
              };
          }
        }
      for (const id of [
        "system/overview",
        "system/404",
        ...manifest.levels.map((level) => `levels/${level.id}`),
      ])
        if (!pages[id]) throw new Error(`Missing Objective Reference: ${id}.`);
      const visited = new Set<string>();
      const active = new Set<string>();
      const visit = (id: string) => {
        if (active.has(id)) throw new Error(`Cyclic Reference: ${id}.`);
        if (visited.has(id)) return;
        const page = pages[id];
        if (!page) throw new Error(`Dangling Reference: ${id}.`);
        active.add(id);
        for (const target of [
          ...page.references,
          ...[...page.content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((match) =>
            required(match[1], "Reference link target"),
          ),
        ])
          visit(target);
        active.delete(id);
        visited.add(id);
      };
      for (const id of Object.keys(pages)) visit(id);
      return [language, pages];
    }),
  );
}
// Scope-local verified bytes are passed explicitly; no mutable global cache.
type BoundCheck = Pick<PreparedCheckArtifact, "digest" | "revision" | "manifest"> &
  (
    | { kind: "local"; prepared: PreparedCheckArtifact }
    | { kind: "remote"; url: string; client: CheckClient }
  );
type CheckContents = ReadonlyMap<BoundCheck, ReadonlyMap<string, Buffer>>;

export async function withObjectiveArtifact<T>(
  directory: string,
  digest: string,
  use: (spec: PilotSpec, runtime: PilotRuntime) => Promise<T>,
  options: PilotSourceOptions = {},
  evidence?: RunEvidence,
): Promise<T> {
  const base = resolve(options.cacheDirectory ?? hostDirectory());
  await ensurePrivateDirectory(base);
  const cache = join(base, "objective-artifacts");
  await ensurePrivateDirectory(cache);
  const specs = new Map<string, PilotSpec>();
  const manifests = new Map<string, ObjectiveArtifactManifest>();
  const preparedChecks = new Map<string, BoundCheck>();
  const active = new Set<string>();
  const contents = new Map<BoundCheck, ReadonlyMap<string, Buffer>>();
  const lifecycle = new AbortController();
  const pending = new Set<Promise<unknown>>();
  async function bind(directory: string, digest: string, expectedId?: string): Promise<PilotSpec> {
    options.signal?.throwIfAborted();
    if (active.has(digest)) throw new Error("Cyclic Objective dependency.");
    if (specs.size + active.size >= 128)
      throw new Error("Objective dependency closure exceeds bounds.");
    const artifact = await prepareData(
      directory,
      digest,
      join(cache, "objectives"),
      options.signal,
    );
    const { manifest } = artifact;
    const prior = specs.get(manifest.id);
    if (
      (expectedId !== undefined && manifest.id !== expectedId) ||
      (prior && prior.version !== digest)
    )
      throw new Error("Conflicting Objective identity/content.");
    if (prior) return prior;
    active.add(digest);
    const checks = new Map<string, BoundCheck>();
    for (const [id, reference] of Object.entries(manifest.checks)) {
      const source =
        reference.source.kind === "directory"
          ? { ...reference.source, directory: resolve(directory, reference.source.directory) }
          : reference.source;
      let check: BoundCheck;
      if (source.kind === "https") {
        const client = await connectHost();
        // Prefer accurate retained metadata. A miss may confirm the source, never upgrade the binding.
        let metadata: ArtifactMetadata;
        try {
          metadata = await client.artifact(source.digest);
        } catch (error) {
          if (!(error instanceof TaskProtocolError && error.status === 404)) throw error;
          metadata = await client.resolveArtifact(source.url);
        }
        if (metadata.digest !== source.digest)
          throw new Error("Objective's fixed Check digest differs from its source.");
        check = {
          kind: "remote",
          url: source.url,
          client,
          digest: metadata.digest,
          revision: metadata.revision,
          manifest: metadata.manifest,
        };
        const files = new Map<string, Buffer>();
        files.set(
          check.manifest.references.check,
          Buffer.from(await client.reference(check.digest, "check")),
        );
        for (const [problem, path] of Object.entries(check.manifest.references.problems))
          files.set(path, Buffer.from(await client.reference(check.digest, `problems/${problem}`)));
        for (const path of check.manifest.references.supporting ?? [])
          files.set(path, Buffer.from(await client.reference(check.digest, path)));
        contents.set(check, files);
      } else {
        const prepared = await prepareCheckArtifact(source, {
          cacheDirectory: join(cache, "checks"),
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.preparationTimeoutMs ? { timeoutMs: options.preparationTimeoutMs } : {}),
        });
        check = { ...prepared, kind: "local", prepared };
        const verified = await inspectCheckArtifact(prepared.artifactDirectory);
        if (verified.digest !== check.digest) throw new Error("Prepared Check References changed.");
        contents.set(check, verified.files);
      }
      if (
        Object.keys(check.manifest.references.problems).some(
          (problem) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(problem),
        )
      )
        throw new Error("Check problem IDs must use the Pilot flat identifier vocabulary.");
      for (const level of manifest.levels)
        for (const item of level.checks.filter((item) => item.id === id))
          if (
            item.problems.some(
              (problem) => !Object.hasOwn(check.manifest.references.problems, problem),
            )
          )
            throw new Error("Objective declares a problem not reported by its Check.");
      checks.set(id, check);
      preparedChecks.set(JSON.stringify([manifest.id, id]), check);
    }
    const bindings: Record<string, Omit<ArtifactObjectiveSource, "bindings">> = {};
    for (const [id, dependency] of Object.entries(manifest.dependencies)) {
      const spec = await bind(resolve(directory, dependency.directory), dependency.digest, id);
      if (spec.source?.kind !== "objective-artifact")
        throw new Error("Invalid artifact dependency.");
      const { bindings: transitive, ...own } = spec.source;
      bindings[id] = own;
      Object.assign(bindings, transitive);
    }
    const source: ArtifactObjectiveSource = {
      kind: "objective-artifact",
      objectiveId: manifest.id,
      artifactDigest: digest,
      directory: resolve(directory),
      checks: Object.fromEntries(
        [...checks].map(([id, check]) => [id, { digest: check.digest, revision: check.revision }]),
      ),
      ...(Object.keys(bindings).length ? { bindings } : {}),
    };
    validatePilotSource(manifest.id, digest, source);
    const expected = options.sources?.[manifest.id];
    if (
      (options.versions?.[manifest.id] !== undefined && options.versions[manifest.id] !== digest) ||
      (expected !== undefined && !sameObjectiveSource(expected, source))
    )
      throw new Error(
        "Frozen Objective closure or Check Host revision differs from recovery evidence.",
      );
    const spec = immutable({
      objectiveId: manifest.id,
      version: digest,
      source,
      manifest: pilotManifest(manifest),
      locales: referenceLocales(artifact, checks, contents),
    });
    specs.set(manifest.id, spec);
    manifests.set(manifest.id, manifest);
    active.delete(digest);
    evidence?.stream.emit("source.prepared", {
      objectiveId: spec.objectiveId,
      version: digest,
      source,
    });
    return spec;
  }
  const spec = await bind(resolve(directory), digest);
  const runtimes = new Map<string, PilotRuntime>();
  function runtimeFor(id: string): PilotRuntime {
    const existing = runtimes.get(id);
    if (existing) return existing;
    const manifest = required(manifests.get(id), "Objective manifest");
    const runtime: PilotRuntime = {
      ...(options.observationBudget ? { observationBudget: options.observationBudget } : {}),
      boundObjectives: () => [...specs.values()],
      async resolveObjective(objectiveId, version, signal, source) {
        signal.throwIfAborted();
        if (!Object.hasOwn(manifest.dependencies, objectiveId))
          throw new Error("Objective dependency is outside the manifest's fixed source boundary.");
        const dependency = specs.get(objectiveId);
        if (
          !dependency ||
          (version !== undefined && version !== dependency.version) ||
          (source !== undefined && !sameObjectiveSource(source, dependency.source))
        )
          throw new Error("Dependency does not match the fixed Objective closure.");
        return { spec: dependency, runtime: runtimeFor(objectiveId) };
      },
      resolveCheck(ref) {
        if (
          ref.objectiveId !== id ||
          !manifest.levels
            .find((level) => level.id === ref.levelId)
            ?.checks.some((check) => check.id === ref.checkId)
        )
          throw new Error("Unknown Check reference.");
        const reference = required(manifest.checks[ref.checkId], "Check reference");
        const check = required(
          preparedChecks.get(JSON.stringify([id, ref.checkId])),
          "Check artifact",
        );
        const project = compileSubjectProjection(reference.subject, { requireDefined: true });
        const subjectValidator = new Ajv({ strict: false, validateFormats: false }).compile(
          check.manifest.subjectSchema,
        );
        const resultValidator = new Ajv({ strict: false, validateFormats: false }).compile(
          check.manifest.resultSchema,
        );
        const probeOptions = {
          ...(options.probeTimeoutMs ? { timeoutMs: options.probeTimeoutMs } : {}),
          evidence: evidence ?? (false as const),
          identity: { ...ref, artifactDigest: check.digest, revision: check.revision },
        };
        const probe =
          check.kind === "remote"
            ? createArtifactCheckProbe({
                ...probeOptions,
                check: { url: check.url, digest: check.digest },
                client: check.client,
              })
            : createWorkerCheckProbe({
                ...probeOptions,
                directory: check.prepared.directory,
                revision: check.revision,
              });
        return async (subject, signal, resolutions) => {
          const mapped = project(subject);
          if (!record(mapped) || !isJsonValue(mapped) || !subjectValidator(mapped))
            throw new Error("Mapped Check subject violates its declared schema.");
          const lifetime = AbortSignal.any([
            signal,
            lifecycle.signal,
            ...(options.signal ? [options.signal] : []),
          ]);
          lifetime.throwIfAborted();
          const invocation = probe(mapped, lifetime, resolutions);
          pending.add(invocation);
          try {
            const result = await invocation;
            if (result.payload !== null && !resultValidator(result))
              throw new Error("Check result violates its artifact resultSchema.");
            return result;
          } finally {
            pending.delete(invocation);
          }
        };
      },
    };
    runtimes.set(id, runtime);
    return runtime;
  }
  try {
    return await use(spec, runtimeFor(spec.objectiveId));
  } finally {
    lifecycle.abort(new Error("Objective artifact scope closed."));
    await Promise.allSettled([...pending]);
  }
}
