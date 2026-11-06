import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { parseDocument, stringify } from "yaml";
import {
  normalizeTaskText,
  readTaskBundle,
  selectTaskBinary,
} from "@potential-guide/task-protocol";

const pathSchema = Type.String({ minLength: 1 });
export const checkBuildSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    kind: Type.String({ pattern: "^[a-z][a-z0-9-]*$" }),
    source: Type.Object(
      { root: pathSchema, entry: pathSchema, contract: pathSchema },
      { additionalProperties: false },
    ),
    languages: Type.Array(Type.String(), { minItems: 1, uniqueItems: true }),
    problemCodes: Type.Array(Type.String({ pattern: "^[a-z][a-z0-9-]*$", maxLength: 4096 }), {
      uniqueItems: true,
    }),
    references: Type.Record(
      Type.String(),
      Type.Object(
        { check: pathSchema, problems: Type.Record(Type.String(), pathSchema) },
        { additionalProperties: false },
      ),
    ),
    referenceRoot: pathSchema,
    resources: Type.Optional(
      Type.Array(
        Type.Object({ from: pathSchema, to: pathSchema }, { additionalProperties: false }),
      ),
    ),
    binary: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 256 })),
  },
  { additionalProperties: false },
);
export type CheckBuild = Static<typeof checkBuildSchema>;

function yaml(text: string, file: string): unknown {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${file}: ${document.errors.join("; ")}`);
  return document.toJS({ maxAliasCount: 0 });
}

function portable(path: string) {
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    /[:*?[\]{}]/.test(path)
  )
    throw new Error(`Invalid relative path: ${path}`);
  return path;
}

async function safeFile(root: string, path: string): Promise<Buffer> {
  const parts = portable(path).split("/");
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile()))
      throw new Error(`Not an ordinary file path: ${current}`);
  }
  return readFile(current);
}

async function files(root: string, prefix = ""): Promise<string[]> {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`Not an ordinary directory: ${root}`);
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Linked input: ${path}`);
    if (entry.isDirectory()) output.push(...(await files(join(root, entry.name), path)));
    else if (entry.isFile()) output.push(path);
    else throw new Error(`Not an ordinary input: ${path}`);
  }
  return output.sort();
}

async function safeDirectory(root: string, path: string): Promise<void> {
  let current = root;
  for (const part of portable(path).split("/")) {
    current = join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Not an ordinary directory: ${current}`);
  }
}

async function outputDirectory(root: string, path: string): Promise<void> {
  let current = root;
  for (const part of portable(path).split("/")) {
    current = join(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Not an ordinary output directory: ${current}`);
  }
}

export function validateReference(bytes: Uint8Array, path: string): void {
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(normalizeTaskText(bytes, path))
    .replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error(`${path}: missing Reference YAML frontmatter`);
  const metadata = yaml(match[1] ?? "", path);
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    Object.keys(metadata).some((key) => !["title", "description"].includes(key)) ||
    !("title" in metadata) ||
    typeof metadata.title !== "string" ||
    !metadata.title.trim() ||
    !("description" in metadata) ||
    typeof metadata.description !== "string" ||
    !metadata.description.trim() ||
    [...metadata.description].length > 200
  )
    throw new Error(
      `${path}: Reference requires only nonempty title and description (<=200 code points)`,
    );
}

export interface PreparedCheck {
  kind: string;
  buildFile: string;
  staging: string;
  resources: ReadonlyMap<string, Buffer>;
  binary: readonly string[];
}

/** Freeze author inputs before the ordinary Task compiler runs. */
export async function prepareCheck(buildFile: string): Promise<PreparedCheck> {
  const root = dirname(resolve(buildFile));
  const raw = yaml(await readFile(buildFile, "utf8"), buildFile);
  if (!Value.Check(checkBuildSchema, raw))
    throw new Error(
      `${buildFile}: invalid Check Build YAML: ${[...Value.Errors(checkBuildSchema, raw)].map((error) => `${error.path} ${error.message}`).join("; ")}`,
    );
  const config = raw;
  const fail = (message: string): never => {
    throw new Error(`Check ${config.kind}: ${message}`);
  };
  for (const language of config.languages) {
    try {
      if (Intl.getCanonicalLocales(language)[0] !== language)
        fail(`noncanonical language ${language}`);
    } catch {
      fail(`invalid language ${language}`);
    }
  }
  if (Object.keys(config.references).some((language) => !config.languages.includes(language)))
    fail("unknown Reference language");
  portable(config.referenceRoot);
  portable(config.source.root);
  if ([config.source.root, config.referenceRoot].some((path) => path.split("/")[0] === "dist"))
    fail("author source/Reference roots must not overlap generated dist outputs");
  await safeDirectory(root, config.source.root);
  await safeDirectory(root, config.referenceRoot);
  for (const entry of await readdir(join(root, config.referenceRoot), { withFileTypes: true })) {
    if (!entry.isDirectory() || !config.languages.includes(entry.name))
      fail(`unknown language or filename ${config.referenceRoot}/${entry.name}`);
    for (const child of await readdir(join(root, config.referenceRoot, entry.name), {
      withFileTypes: true,
    })) {
      if (child.name === "check.md" && child.isFile()) continue;
      if (child.name !== "problems" || !child.isDirectory())
        fail(`unknown Reference path ${config.referenceRoot}/${entry.name}/${child.name}`);
      for (const problem of await readdir(
        join(root, config.referenceRoot, entry.name, "problems"),
        { withFileTypes: true },
      ))
        if (!problem.isFile() || !config.problemCodes.some((code) => problem.name === `${code}.md`))
          fail(`${entry.name}: unknown problem filename ${problem.name}`);
    }
  }
  const resources = new Map<string, Buffer>();
  const selected = new Set<string>();
  for (const language of config.languages) {
    const mapping = config.references[language];
    if (!mapping) return fail(`missing ${language} definition mapping`);
    const required = new Map<string, string>([["check.md", mapping.check]]);
    if (Object.keys(mapping.problems).some((code) => !config.problemCodes.includes(code)))
      fail(`${language}: unknown problem code`);
    for (const code of config.problemCodes) {
      const path = mapping.problems[code];
      if (!path) return fail(`${language}: missing problem ${code}`);
      required.set(`problems/${code}.md`, path);
    }
    for (const [suffix, path] of required) {
      const expected = `${config.referenceRoot}/${language}/${suffix}`;
      if (path !== expected)
        fail(`${language}: filename/path mismatch ${path}; expected ${expected}`);
      if (selected.has(path)) fail(`${language}: duplicate mapping ${path}`);
      selected.add(path);
      let bytes: Buffer;
      try {
        bytes = await safeFile(root, path);
        validateReference(bytes, path);
      } catch (error) {
        return fail(`${language} ${suffix} ${path}: ${String(error)}`);
      }
      resources.set(`resources/references/${language}/${suffix}`, bytes);
    }
  }
  const actual = await files(join(root, config.referenceRoot));
  if (actual.some((path) => !selected.has(`${config.referenceRoot}/${path}`)))
    fail(
      `unknown language, problem code or filename in ${config.referenceRoot}: ${actual.filter((path) => !selected.has(`${config.referenceRoot}/${path}`)).join(", ")}`,
    );
  for (const resource of config.resources ?? []) {
    const destination = portable(resource.to);
    if (
      !destination.startsWith("resources/") ||
      resources.has(destination) ||
      destination === "resources/check.json"
    )
      fail(`duplicate or invalid resource destination ${destination}`);
    resources.set(destination, await safeFile(root, resource.from));
  }
  const source = new Map<string, Buffer>();
  for (const path of await files(join(root, config.source.root))) {
    const full = `${config.source.root}/${path}`;
    source.set(full, await safeFile(root, full));
  }
  for (const path of [config.source.entry, config.source.contract])
    if (!source.has(path)) fail(`source not in source root: ${path}`);
  const definitions = `dist/definitions/${config.kind}`;
  const literal = JSON.stringify(config.problemCodes);
  const definitionJs = Buffer.from(`export const problemCodes = Object.freeze(${literal});\n`);
  const definitionTypes = Buffer.from(
    `export declare const problemCodes: readonly [${config.problemCodes.map((code) => JSON.stringify(code)).join(", ")}];\n`,
  );
  source.set(`${definitions}.js`, definitionJs);
  source.set(`${definitions}.d.ts`, definitionTypes);
  const staging = join(root, "dist", "staging", config.kind);
  // Only owned staging inputs are replaced; accepted artifacts are never touched here.
  await outputDirectory(root, "dist/staging");
  await outputDirectory(root, "dist/definitions");
  await outputDirectory(root, `dist/staging/${config.kind}`);
  await rm(staging, { recursive: true, force: true });
  for (const [path, bytes] of [...source, ...resources]) {
    await mkdir(dirname(join(staging, path)), { recursive: true });
    await writeFile(join(staging, path), bytes);
  }
  for (const [extension, bytes] of [
    ["js", definitionJs],
    ["d.ts", definitionTypes],
  ] as const) {
    const path = join(root, `${definitions}.${extension}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  const index = Buffer.from(
    `${JSON.stringify(
      {
        kind: config.kind,
        languages: config.languages,
        problemCodes: config.problemCodes,
        references: Object.fromEntries(
          config.languages.map((language) => [
            language,
            {
              check: `resources/references/${language}/check.md`,
              problems: Object.fromEntries(
                config.problemCodes.map((code) => [
                  code,
                  `resources/references/${language}/problems/${code}.md`,
                ]),
              ),
            },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );
  resources.set("resources/check.json", index);
  await mkdir(join(staging, "resources"), { recursive: true });
  await writeFile(join(staging, "resources", "check.json"), index);
  const generated = {
    $schema: "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task-build/v1.json",
    name: config.name,
    runtime: { minVersion: "22.13.0" },
    source: { entry: config.source.entry, contract: config.source.contract, mode: "explicit" },
    include: [...resources.keys()].map((path) => ({
      from: path,
      to: `${path.slice(0, path.lastIndexOf("/") + 1)}`,
    })),
    outDirectory: "bundle",
    binary: config.binary ?? [],
  };
  const output = join(staging, "task.build.yaml");
  await writeFile(output, stringify(generated));
  const binary = selectTaskBinary(
    ["task.yaml", "worker.cjs", ...resources.keys()],
    config.binary ?? [],
  );
  if (binary.includes("resources/check.json"))
    fail("generated resources/check.json cannot be binary");
  return { kind: config.kind, staging, buildFile: output, resources, binary };
}

/** Compare the CAR's actual resource set and bytes, not its author include list. */
export function verifyCheckResources(
  prepared: PreparedCheck,
  artifact: ReadonlyMap<string, Uint8Array>,
): void {
  const actual = [...artifact.keys()]
    .filter(
      (path) => path !== "task.yaml" && path !== "worker.cjs" && !/^schemas\/\d+\.json$/.test(path),
    )
    .sort();
  const expected = [...prepared.resources.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Check ${prepared.kind}: CAR resource selection mismatch`);
  const { declaration } = readTaskBundle(artifact);
  if (JSON.stringify(declaration.binary) !== JSON.stringify(prepared.binary))
    throw new Error(`Check ${prepared.kind}: CAR binary selection mismatch`);
  for (const [path, bytes] of prepared.resources)
    if (
      !Buffer.from(artifact.get(path) ?? []).equals(
        prepared.binary.includes(path) ? bytes : Buffer.from(normalizeTaskText(bytes, path)),
      )
    )
      throw new Error(`Check ${prepared.kind}: CAR resource bytes differ: ${path}`);
}
