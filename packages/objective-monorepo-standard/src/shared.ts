import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FilesystemObservationView } from "@potential-guide/objective-pilot";
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
  ".staging",
  ".turbo",
  ".next",
  ".wrangler",
  "coverage",
]);
export const secretPath =
  /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|[^/]*\.(?:pem|key|p12)|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?)(?:\/|$)/i;
async function readInputView(): Promise<FilesystemObservationView | undefined> {
  const provided = inputViews.getStore();
  if (provided) return provided;
  const path = process.env.PGUIDE_INPUT_VIEW;
  if (path === undefined) return undefined;
  if (!process.send || !process.connected)
    throw new Error("Input views require the owning process probe.");
  const bytes = await readFile(path);
  if (createHash("sha256").update(bytes).digest("hex") !== process.env.PGUIDE_INPUT_VIEW_SHA256)
    throw new Error("Input view integrity mismatch.");
  const view = JSON.parse(bytes.toString("utf8")) as FilesystemObservationView;
  if (view.schemaVersion !== 1 || typeof view.root !== "string" || !record(view.entries))
    throw new Error("Input view boundary mismatch.");
  return view;
}
const inputViews = new AsyncLocalStorage<FilesystemObservationView>();
export const withInputView = <T>(view: FilesystemObservationView | undefined, use: () => T): T =>
  view === undefined ? use() : inputViews.run(view, use);
export class Snapshot {
  private readonly view: Promise<FilesystemObservationView | undefined>;
  constructor(
    readonly root: string,
    provided?: FilesystemObservationView,
  ) {
    this.view = (provided === undefined ? readInputView() : Promise.resolve(provided)).then(
      (view) => {
        if (view !== undefined && view.root !== root)
          throw new Error("Input view boundary mismatch.");
        return view;
      },
    );
  }
  static async open(root: string): Promise<Snapshot> {
    const view = await readInputView();
    const sameRoot =
      view !== undefined &&
      (process.platform === "win32"
        ? resolve(root).toLowerCase() === view.root.toLowerCase()
        : resolve(root) === view.root);
    const actual = view !== undefined && sameRoot ? view.root : await realpath(root);
    return new Snapshot(actual, view);
  }
  compilerView(): Promise<FilesystemObservationView | undefined> {
    return this.view;
  }
  async path(path: string) {
    const absolute = resolve(this.root, path);
    const rel = relative(this.root, absolute);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) || secretPath.test(path)) {
      throw new Error("Path is outside the observation boundary or is a secret-value file.");
    }
    let current = this.root;
    const view = await this.view;
    if (view !== undefined && rel.split(sep).some((part) => ignored.has(part)))
      throw new Error("Path is excluded by the input view contract.");
    for (const part of rel.split(sep).filter(Boolean)) {
      current = join(current, part);
      if (view !== undefined) {
        if (view.entries[relative(this.root, current).split(sep).join("/")]?.kind === "link")
          throw new Error("Symbolic links are not inspected.");
        continue;
      }
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
      const view = await this.view;
      if (view !== undefined) {
        const absolute = await this.path(path);
        return view.entries[relative(this.root, absolute).split(sep).join("/")]?.kind === "file";
      }
      return (await lstat(await this.path(path))).isFile();
    } catch (error) {
      if (record(error) && error.code === "ENOENT") return false;
      throw error;
    }
  }
  async text(path: string) {
    const absolute = await this.path(path);
    const view = await this.view;
    if (view !== undefined) {
      const file = view.entries[relative(this.root, absolute).split(sep).join("/")];
      if (
        file?.kind !== "file" ||
        file.size === undefined ||
        file.size > 1024 * 1024 ||
        file.text === undefined
      )
        throw new Error("Expected a readable regular file <= 1 MiB.");
      return file.text;
    }
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
  async files(directory = "", includeBuildOutputs = false): Promise<string[]> {
    const view = await this.view;
    if (view !== undefined) {
      const absolute = await this.path(directory);
      const normalized = relative(this.root, absolute).split(sep).join("/");
      if (view.entries[normalized]?.kind !== "directory")
        throw new Error("Expected an observed directory.");
      const prefix = normalized ? `${normalized}/` : "";
      const results: string[] = [];
      for (const [path, entry] of Object.entries(view.entries)) {
        if (!path.startsWith(prefix) || path === normalized) continue;
        const rel = path.slice(prefix.length);
        if (
          !includeBuildOutputs &&
          rel
            .split("/")
            .slice(0, entry.kind === "directory" ? undefined : -1)
            .includes("dist")
        )
          continue;
        if (entry.kind === "directory") await this.path(path);
        else if (entry.kind === "file") results.push(path);
      }
      if (results.length > 20000)
        throw new Error("Inventory exceeds 20,000 files; narrow the target.");
      return results;
    }
    const results: string[] = [];
    for (const item of await readdir(await this.path(directory), { withFileTypes: true })) {
      const path = directory ? `${directory}/${item.name}` : item.name;
      if (
        ignored.has(item.name) ||
        (!includeBuildOutputs && item.isDirectory() && item.name === "dist") ||
        item.isSymbolicLink()
      )
        continue;
      if (item.isDirectory()) results.push(...(await this.files(path, includeBuildOutputs)));
      else if (item.isFile()) results.push(path);
      if (results.length > 20000)
        throw new Error("Inventory exceeds 20,000 files; narrow the target.");
    }
    return results;
  }
  async workspaceManifests(patterns: string[]): Promise<string[]> {
    const view = await this.view;
    if (view !== undefined) {
      return Object.entries(view.entries)
        .filter(([path, entry]) => {
          if (
            entry.kind !== "file" ||
            !path.endsWith("/package.json") ||
            path.split("/").includes("dist")
          )
            return false;
          const directory = path.slice(0, -"/package.json".length);
          return (
            patterns.some((pattern) => !pattern.startsWith("!") && matches(directory, pattern)) &&
            !patterns.some(
              (pattern) => pattern.startsWith("!") && matches(directory, pattern.slice(1)),
            )
          );
        })
        .map(([path]) => path);
    }
    const positive = patterns.filter((pattern) => !pattern.startsWith("!"));
    function possible(directory: string, pattern: string): boolean {
      const parts = directory.split("/");
      const segments = pattern.split("/");
      function prefix(i: number, j: number): boolean {
        if (i === parts.length) return true;
        const segment = segments[j];
        if (segment === undefined) return false;
        if (segment === "**") return prefix(i, j + 1) || prefix(i + 1, j);
        return matches(parts[i] ?? "", segment) && prefix(i + 1, j + 1);
      }
      return prefix(0, 0);
    }
    const result: string[] = [];
    let count = 0;
    const walk = async (directory: string): Promise<void> => {
      if (++count > 20000) throw new Error("Workspace discovery exceeds 20,000 directories.");
      const entries = await readdir(await this.path(directory), { withFileTypes: true });
      if (
        directory &&
        positive.some((pattern) => matches(directory, pattern)) &&
        !patterns.some(
          (pattern) => pattern.startsWith("!") && matches(directory, pattern.slice(1)),
        ) &&
        entries.some(
          (entry) => entry.name === "package.json" && entry.isFile() && !entry.isSymbolicLink(),
        )
      )
        result.push(`${directory}/package.json`);
      for (const entry of entries) {
        if (
          !entry.isDirectory() ||
          entry.isSymbolicLink() ||
          ignored.has(entry.name) ||
          entry.name === "dist"
        )
          continue;
        const path = directory ? `${directory}/${entry.name}` : entry.name;
        if (positive.some((pattern) => possible(path, pattern))) await walk(path);
      }
    };
    await walk("");
    return result;
  }
}
export const ajv = new Ajv({ allErrors: true, strict: true });
export const isNodeImport = isBuiltin;
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
