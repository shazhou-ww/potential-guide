import { lstat, readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Ajv } from "ajv";
export type State = "pass" | "fail" | "unverified" | "not-applicable";
export interface Finding {
  layer: 1 | 2;
  state: State;
  rule: string;
  location: string;
  evidence: string;
  remedy: string;
  requirements: string[];
  packages: string[];
  targetDirectory?: string;
}
export interface Report {
  schemaVersion: 1;
  scope: "delivery-preparation";
  state: State;
  layer2: "checked" | "blocked" | "not-requested";
  findings: Finding[];
  evidenceKind: "configuration-and-existing-files";
  onlineVerified: false;
  limitations: string[];
}
export type RecordValue = Record<string, unknown>;
export function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function texts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(texts);
  return record(value) ? Object.values(value).flatMap(texts) : [];
}
export function under(path: string, directory: string) {
  return path === directory || path.startsWith(`${directory}/`);
}
export const ignored = new Set([
  ".git",
  "node_modules",
  ".cache",
  ".turbo",
  ".next",
  ".wrangler",
  "coverage",
]);
export const secretPath =
  /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|.*\.(?:pem|key|p12)|credentials(?:\..*)?|secrets?(?:\..*)?)$/i;
export class Snapshot {
  constructor(readonly root: string) {}
  async path(path: string) {
    const absolute = resolve(this.root, path);
    const rel = relative(this.root, absolute);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) || secretPath.test(path)) {
      throw new Error("Path is outside the observation boundary or is a secret-value file.");
    }
    let current = this.root;
    for (const part of rel.split(sep).filter(Boolean)) {
      current = join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error("Symbolic links are not inspected.");
      } catch (error) {
        if (!record(error) || error.code !== "ENOENT") throw error;
        return absolute;
      }
    }
    return absolute;
  }
  async exists(path: string) {
    try {
      return (await lstat(await this.path(path))).isFile();
    } catch (error) {
      if (record(error) && error.code === "ENOENT") return false;
      throw error;
    }
  }
  async text(path: string) {
    const absolute = await this.path(path);
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.size > 1024 * 1024)
      throw new Error("Expected a regular file <= 1 MiB.");
    return readFile(absolute, "utf8");
  }
  async json(path: string): Promise<RecordValue> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await this.text(path));
    } catch {
      throw new SyntaxError("Invalid JSON; source values are intentionally omitted.");
    }
    if (!record(parsed)) throw new TypeError("Expected a JSON object.");
    return parsed;
  }
  async files(directory = ""): Promise<string[]> {
    const results: string[] = [];
    for (const item of await readdir(await this.path(directory), { withFileTypes: true })) {
      const path = directory ? `${directory}/${item.name}` : item.name;
      if (ignored.has(item.name) || item.isSymbolicLink()) continue;
      if (item.isDirectory()) results.push(...(await this.files(path)));
      else if (item.isFile()) results.push(path);
      if (results.length > 20000)
        throw new Error("Inventory exceeds 20,000 files; narrow the target.");
    }
    return results;
  }
}
export const ajv = new Ajv({ allErrors: true, strict: true });
export const nodeImports = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
export const packageValidator = ajv.compile({
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    private: { type: "boolean" },
    scripts: { type: "object", additionalProperties: { type: "string" } },
    dependencies: { type: "object", additionalProperties: { type: "string" } },
    devDependencies: { type: "object", additionalProperties: { type: "string" } },
    peerDependencies: { type: "object", additionalProperties: { type: "string" } },
    optionalDependencies: { type: "object", additionalProperties: { type: "string" } },
    files: { type: "array", items: { type: "string" } },
    engines: { type: "object", additionalProperties: { type: "string" } },
    bin: {
      anyOf: [{ type: "string" }, { type: "object", additionalProperties: { type: "string" } }],
    },
  },
});
export const workspaceValidator = ajv.compile({
  type: "object",
  required: ["packages"],
  properties: {
    packages: { type: "array", minItems: 1, items: { type: "string" } },
    catalog: { type: "object", additionalProperties: { type: "string" } },
    catalogs: {
      type: "object",
      additionalProperties: { type: "object", additionalProperties: { type: "string" } },
    },
    allowBuilds: { type: "object", additionalProperties: { type: "boolean" } },
    onlyBuiltDependencies: { type: "array", items: { type: "string" } },
    ignoredBuiltDependencies: { type: "array", items: { type: "string" } },
    minimumReleaseAge: { type: "number", minimum: 0 },
    minimumReleaseAgeExclude: { type: "array", items: { type: "string" } },
    overrides: { type: "object", additionalProperties: { type: "string" } },
    catalogMode: { enum: ["manual", "prefer", "strict"] },
    cleanupUnusedCatalogs: { type: "boolean" },
    linkWorkspacePackages: { anyOf: [{ type: "boolean" }, { const: "deep" }] },
    preferWorkspacePackages: { type: "boolean" },
  },
});
export const workspaceFields = new Set([
  "packages",
  "catalog",
  "catalogs",
  "allowBuilds",
  "onlyBuiltDependencies",
  "ignoredBuiltDependencies",
  "minimumReleaseAge",
  "minimumReleaseAgeExclude",
  "overrides",
  "catalogMode",
  "cleanupUnusedCatalogs",
  "linkWorkspacePackages",
  "preferWorkspacePackages",
]);
export const turboValidator = ajv.compile({
  type: "object",
  required: ["tasks"],
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    ui: { enum: ["stream", "tui"] },
    globalDependencies: { type: "array", items: { type: "string" } },
    globalEnv: { type: "array", items: { type: "string" } },
    tasks: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        properties: {
          dependsOn: { type: "array", items: { type: "string" } },
          outputs: { type: "array", items: { type: "string" } },
          inputs: { type: "array", items: { type: "string" } },
          env: { type: "array", items: { type: "string" } },
          cache: { type: "boolean" },
          persistent: { type: "boolean" },
        },
      },
    },
  },
});
export function matches(path: string, pattern: string) {
  const expression = pattern
    .split("/")
    .map((part) =>
      part === "**"
        ? ".*"
        : part
            .split("*")
            .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("[^/]*"),
    )
    .join("/");
  return new RegExp(`^${expression}$`).test(path);
}
export function taskFor(tasks: RecordValue, name: string, task: string) {
  const value = tasks[`${name}#${task}`] ?? tasks[task];
  return record(value) ? value : undefined;
}
export function dependencyGroups(manifest: RecordValue) {
  return ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"].flatMap(
    (kind) =>
      record(manifest[kind])
        ? Object.entries(manifest[kind]).map(([name, version]) => ({ kind, name, version }))
        : [],
  );
}
export function summary(findings: Finding[]): State {
  if (findings.some((finding) => finding.state === "fail")) return "fail";
  if (findings.some((finding) => finding.state === "unverified")) return "unverified";
  return "pass";
}
export async function resolveSource(snapshot: Snapshot, source: string, specifier: string) {
  const base = relative(snapshot.root, resolve(snapshot.root, dirname(source), specifier))
    .split(sep)
    .join("/");
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.jsx$/, ".tsx"),
    base.replace(/\.mjs$/, ".mts"),
    base.replace(/\.cjs$/, ".cts"),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}/index.ts`,
    `${base}/index.js`,
  ];
  for (const candidate of new Set(candidates))
    if (await snapshot.exists(candidate)) return candidate;
  return undefined;
}
export type Add = (
  layer: 1 | 2,
  state: State,
  rule: string,
  location: string,
  evidence: string,
  remedy: string,
  packages?: string[],
  requirements?: string[],
  targetDirectory?: string,
) => void;
export type ReportPut = (
  state: State,
  rule: string,
  evidence: string,
  remedy?: string,
  location?: string,
) => void;
export type Dependency = ReturnType<typeof dependencyGroups>[number];
