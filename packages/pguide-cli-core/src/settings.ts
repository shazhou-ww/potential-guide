import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Ajv } from "ajv";
import type { ParseError } from "jsonc-parser";
import { atomicWrite, CliError } from "./index.js";
import { parseRegulationPermissions } from "./permissions.js";

export type PguideConfig = Record<string, unknown>;
export interface SettingDescription {
  schema: Record<string, unknown>;
  description: string;
  default?: unknown;
}
interface Registration {
  name: string;
  root: string;
  namespace: string;
}
export interface SettingsIssue {
  id: string;
  source: string;
  message: string;
}
export interface LoadedConfig {
  value: PguideConfig;
  sources: Record<string, string>;
  paths: { user: string; project?: string };
  files: string[];
  issues: SettingsIssue[];
  unverified: SettingsIssue[];
}
type SettingValidator = ((value: unknown) => boolean) & { errors?: unknown };
export interface SettingsCatalog {
  namespaces: Map<string, string>;
  settings: Map<string, { description: SettingDescription; validate: SettingValidator }>;
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const namespacePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const require = createRequire(import.meta.url);
const jsonc = (): typeof import("jsonc-parser") => require("jsonc-parser");

export function userConfigPath(): string {
  const root =
    platform() === "win32"
      ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"))
      : (process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
  return join(root, "pguide", "config.jsonc");
}

export function settingsPackagesPath(): string {
  return join(dirname(userConfigPath()), "settings-packages.json");
}

export function parseJsonc(source: string): unknown {
  const { parseTree, getNodeValue, visit } = jsonc();
  const errors: ParseError[] = [];
  const tree = parseTree(source, errors, {
    allowTrailingComma: true,
    allowEmptyContent: false,
  });
  const objects: Set<string>[] = [];
  let duplicate: string | undefined;
  visit(source, {
    onObjectBegin: () => {
      objects.push(new Set());
    },
    onObjectProperty: (name) => {
      const keys = objects.at(-1);
      if (keys?.has(name)) duplicate = name;
      keys?.add(name);
    },
    onObjectEnd: () => {
      objects.pop();
    },
  });
  if (errors.length > 0) throw new CliError(`Invalid JSONC at offset ${errors[0]?.offset}.`);
  if (duplicate !== undefined) throw new CliError(`Duplicate JSONC key: ${duplicate}.`);
  // AST evaluation preserves literal __proto__ keys instead of invoking a prototype setter.
  return tree === undefined ? undefined : structuredClone(getNodeValue(tree));
}

export function parseConfig(source: string): PguideConfig {
  const value = parseJsonc(source);
  if (!object(value)) throw new CliError("Configuration must be a JSONC object.");
  for (const id of Object.keys(value)) {
    const dot = id.indexOf(".");
    if (dot < 1 || dot === id.length - 1 || !namespacePattern.test(id.slice(0, dot)))
      throw new CliError(
        `Invalid setting ID ${id}. Use complete namespace.setting IDs in config.jsonc; migrate legacy YAML manually.`,
      );
  }

  return value;
}

function parseStaticJson(source: string): unknown {
  const value: unknown = JSON.parse(source);
  parseJsonc(source);
  return value;
}

function removeSetting(source: string, id: string): string {
  const { parseTree, createScanner, applyEdits } = jsonc();
  const properties = parseTree(source, [], { allowTrailingComma: true })?.children ?? [];
  const index = properties.findIndex((property) => property.children?.[0]?.value === id);
  const property = properties[index];
  if (property === undefined) return source;
  const edits = [{ offset: property.offset, length: property.length, content: "" }];
  // Delete tokens, not the surrounding trivia: comments may belong to either neighbor.
  const scanner = createScanner(source, true);
  scanner.setPosition(property.offset + property.length);
  scanner.scan();
  if (source[scanner.getTokenOffset()] !== ",") {
    const previous = properties[index - 1];
    if (previous !== undefined) {
      scanner.setPosition(previous.offset + previous.length);
      scanner.scan();
    }
  }
  if (source[scanner.getTokenOffset()] === ",")
    edits.push({ offset: scanner.getTokenOffset(), length: scanner.getTokenLength(), content: "" });
  return applyEdits(source, edits);
}

export function editConfig(source: string, id: string, value: unknown): string {
  const { applyEdits, modify } = jsonc();
  parseConfig(source);
  const next =
    value === undefined
      ? removeSetting(source, id)
      : applyEdits(
          source,
          modify(source, [id], value, {
            formattingOptions: {
              insertSpaces: true,
              tabSize: 2,
              eol: source.includes("\r\n") ? "\r\n" : "\n",
            },
          }),
        );
  parseConfig(next);
  return next;
}

function validateValue(id: string, value: unknown, validate: SettingValidator): string | undefined {
  if (!validate(value)) return JSON.stringify(validate.errors);
  if (id === "regulate.permissions") {
    try {
      parseRegulationPermissions(value);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  return undefined;
}

async function addDescription(
  catalog: SettingsCatalog,
  name: string,
  raw: unknown,
  validators?: Readonly<Record<string, SettingValidator>>,
): Promise<string> {
  if (
    !object(raw) ||
    raw.schemaVersion !== 1 ||
    typeof raw.namespace !== "string" ||
    !namespacePattern.test(raw.namespace) ||
    !object(raw.settings) ||
    Object.keys(raw).some((key) => !["schemaVersion", "namespace", "settings"].includes(key))
  )
    throw new CliError(`Invalid settings description for ${name}.`);
  const namespace = raw.namespace;
  const owner = catalog.namespaces.get(namespace);
  if (owner === name) {
    const existing = Object.fromEntries(
      [...catalog.settings]
        .filter(([id]) => id.startsWith(`${namespace}.`))
        .map(([id, entry]) => [id, entry.description]),
    );
    if (isDeepStrictEqual(existing, raw.settings)) return namespace;
    throw new CliError(`Conflicting settings descriptions for package ${name}.`);
  }
  if (owner !== undefined)
    throw new CliError(`Settings namespace conflict: ${namespace} (${owner}, ${name}).`);
  if ([...catalog.namespaces.values()].includes(name))
    throw new CliError(`Conflicting settings descriptions for package ${name}.`);
  let ajv: Ajv | undefined;
  if (validators === undefined) {
    const { Ajv } = await import("ajv");
    ajv = new Ajv({ allErrors: true, strict: true });
  }
  for (const [id, entry] of Object.entries(raw.settings)) {
    if (
      !id.startsWith(`${namespace}.`) ||
      id.length === namespace.length + 1 ||
      !object(entry) ||
      !object(entry.schema) ||
      typeof entry.description !== "string" ||
      Object.keys(entry).some((key) => !["schema", "description", "default"].includes(key))
    )
      throw new CliError(`Invalid setting description: ${name} ${id}.`);
    let validate: SettingValidator;
    try {
      const compiled = validators?.[id] ?? ajv?.compile(entry.schema);
      if (compiled === undefined) throw new Error("Missing built-in settings validator.");
      validate = compiled;
      if ("$async" in validate && validate.$async === true)
        throw new Error("Settings schemas must validate synchronously.");
    } catch (error) {
      throw new CliError(`Invalid local schema for ${id}: ${String(error)}`);
    }
    if (Object.hasOwn(entry, "default")) {
      const problem = validateValue(id, entry.default, validate);
      if (problem) throw new CliError(`Invalid static default for ${id}: ${problem}`);
    }
    catalog.settings.set(id, { description: entry as unknown as SettingDescription, validate });
  }
  catalog.namespaces.set(namespace, name);
  return namespace;
}

async function registrations(): Promise<Registration[]> {
  let source: string;
  try {
    source = await readFile(settingsPackagesPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let raw: unknown;
  try {
    raw = parseStaticJson(source);
  } catch {
    throw new CliError(
      `Invalid settings registry: ${settingsPackagesPath()}. Repair the registry explicitly.`,
    );
  }
  if (
    !object(raw) ||
    raw.schemaVersion !== 1 ||
    !Array.isArray(raw.packages) ||
    Object.keys(raw).some((key) => !["schemaVersion", "packages"].includes(key)) ||
    !raw.packages.every(
      (entry) =>
        object(entry) &&
        typeof entry.name === "string" &&
        entry.name.length > 0 &&
        typeof entry.root === "string" &&
        isAbsolute(entry.root) &&
        typeof entry.namespace === "string" &&
        namespacePattern.test(entry.namespace) &&
        Object.keys(entry).every((key) => ["name", "root", "namespace"].includes(key)),
    )
  )
    throw new CliError(
      `Invalid settings registry: ${settingsPackagesPath()}. Repair the registry explicitly.`,
    );
  return raw.packages as Registration[];
}

async function packageDescription(root: string): Promise<{ name: string; description: unknown }> {
  try {
    const metadata = parseStaticJson(await readFile(join(root, "package.json"), "utf8"));
    if (
      !object(metadata) ||
      typeof metadata.name !== "string" ||
      metadata.name.length === 0 ||
      !object(metadata.pguide) ||
      typeof metadata.pguide.settings !== "string" ||
      isAbsolute(metadata.pguide.settings)
    )
      throw new Error("package.json must declare name and a relative pguide.settings path.");
    const realRoot = await realpath(root);
    const path = await realpath(resolve(root, metadata.pguide.settings));
    const within = relative(realRoot, path);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within))
      throw new Error("Settings description must stay inside the package.");
    return { name: metadata.name, description: parseStaticJson(await readFile(path, "utf8")) };
  } catch (error) {
    throw new CliError(
      `Cannot load registered settings package ${root}: ${String(error)}. Repair it or explicitly unregister its root.`,
    );
  }
}

let builtInCatalog: Promise<SettingsCatalog> | undefined;
async function compileBuiltInCatalog(): Promise<SettingsCatalog> {
  const { builtInSettings, builtInValidators } = await import("./built-in-settings.js");
  const catalog: SettingsCatalog = { namespaces: new Map(), settings: new Map() };
  for (const entry of builtInSettings)
    await addDescription(catalog, entry.name, entry.description, builtInValidators);
  return catalog;
}

export async function loadSettingsCatalog(entries?: Registration[]): Promise<SettingsCatalog> {
  // Only bundled immutable descriptions are cached; registrations are reread and revalidated.
  builtInCatalog ??= compileBuiltInCatalog();
  const builtins = await builtInCatalog;
  const catalog: SettingsCatalog = {
    namespaces: new Map(builtins.namespaces),
    settings: new Map(builtins.settings),
  };
  const roots = new Map<string, Registration>();
  for (const entry of entries ?? (await registrations())) {
    const root = await realpath(entry.root).catch(() => {
      throw new CliError(
        `Registered settings package missing: ${entry.root}. Restore it or explicitly unregister it.`,
      );
    });
    const previous = roots.get(root);
    if (previous) {
      if (previous.name !== entry.name || previous.namespace !== entry.namespace)
        throw new CliError(`Conflicting registration identity at ${root}.`);
      continue;
    }
    roots.set(root, entry);
    const loaded = await packageDescription(root);
    if (
      loaded.name !== entry.name ||
      !object(loaded.description) ||
      loaded.description.namespace !== entry.namespace
    )
      throw new CliError(
        `Registered package identity or namespace changed at ${root}. Explicitly unregister and register it again.`,
      );
    await addDescription(catalog, loaded.name, loaded.description);
  }
  return catalog;
}

export async function registerSettingsPackage(root: string): Promise<void> {
  const canonical = await realpath(resolve(root));
  const loaded = await packageDescription(canonical);
  const check: SettingsCatalog = { namespaces: new Map(), settings: new Map() };
  const namespace = await addDescription(check, loaded.name, loaded.description);
  const entries = await registrations();
  const previous = entries.find((entry) => entry.root === canonical);
  if (previous && (previous.name !== loaded.name || previous.namespace !== namespace))
    throw new CliError("Package identity changed; explicitly unregister the old entry first.");
  const next = [
    ...entries.filter((entry) => entry.root !== canonical),
    { name: loaded.name, root: canonical, namespace },
  ];
  await loadSettingsCatalog(next);
  await atomicWrite(
    settingsPackagesPath(),
    `${JSON.stringify({ schemaVersion: 1, packages: next }, null, 2)}\n`,
  );
}

export async function unregisterSettingsPackage(root: string): Promise<void> {
  const absolute = resolve(root);
  const canonical = await realpath(absolute).catch(() => absolute);
  const entries = await registrations();
  const next = entries.filter((entry) => entry.root !== canonical && entry.root !== absolute);
  if (next.length === entries.length)
    throw new CliError(`Settings package is not registered: ${absolute}.`);
  await atomicWrite(
    settingsPackagesPath(),
    `${JSON.stringify({ schemaVersion: 1, packages: next }, null, 2)}\n`,
  );
}

export function inspectSettings(
  value: PguideConfig,
  source: string,
  catalog: SettingsCatalog,
): {
  issues: SettingsIssue[];
  unverified: SettingsIssue[];
} {
  const issues: SettingsIssue[] = [];
  const unverified: SettingsIssue[] = [];
  for (const [id, entry] of Object.entries(value)) {
    const namespace = id.slice(0, id.indexOf("."));
    if (!catalog.namespaces.has(namespace)) {
      unverified.push({
        id,
        source,
        message: "Unverified: namespace description is not registered.",
      });
      continue;
    }
    const descriptor = catalog.settings.get(id);
    const message = descriptor
      ? validateValue(id, entry, descriptor.validate)
      : "Unknown setting in a known namespace.";
    if (message) issues.push({ id, source, message });
  }
  return { issues, unverified };
}

export function requireSettings(
  loaded: LoadedConfig,
  namespaces?: readonly string[],
): LoadedConfig {
  const issues =
    namespaces === undefined
      ? loaded.issues
      : loaded.issues.filter((issue) =>
          namespaces.includes(issue.id.slice(0, issue.id.indexOf("."))),
        );
  if (issues.length)
    throw new CliError("Invalid configuration settings.", 2, "invalid", {
      issues,
      unverified: loaded.unverified,
    });
  return loaded;
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function rejectLegacyConfig(path: string): Promise<void> {
  for (const extension of ["yaml", "yml"]) {
    const legacy = path.replace(/jsonc$/, extension);
    if (await exists(legacy))
      throw new CliError(
        `Legacy main configuration ${legacy} is not supported, including alongside config.jsonc. Manually migrate complete setting IDs to config.jsonc and move the old file out of discovery.`,
      );
  }
}

export async function existingProjectConfig(cwd: string): Promise<string | undefined> {
  let current = resolve(cwd);
  while (true) {
    const path = join(current, ".pguide", "config.jsonc");
    await rejectLegacyConfig(path);
    if (await exists(path)) return path;
    const parent = dirname(current);
    if (current === parent) return undefined;
    current = parent;
  }
}

export async function loadConfig(
  cwd: string,
  namespaces?: readonly string[],
): Promise<LoadedConfig> {
  const catalog = await loadSettingsCatalog();
  const user = userConfigPath();
  await rejectLegacyConfig(user);
  const project = await existingProjectConfig(cwd);
  const loaded: LoadedConfig = {
    value: {},
    sources: {},
    paths: { user, ...(project ? { project } : {}) },
    files: [],
    issues: [],
    unverified: [],
  };
  const merge = (value: PguideConfig, source: string) => {
    const result = inspectSettings(value, source, catalog);
    loaded.issues.push(...result.issues);
    loaded.unverified.push(...result.unverified);
    Object.assign(loaded.value, value);
    for (const id of Object.keys(value)) loaded.sources[id] = source;
  };
  for (const path of [user, project]) {
    if (path === undefined || !(await exists(path))) continue;
    merge(parseConfig(await readFile(path, "utf8")), path);
    loaded.files.push(path);
  }
  for (const [id, { description }] of catalog.settings) {
    if (!Object.hasOwn(loaded.value, id) && Object.hasOwn(description, "default")) {
      loaded.value[id] = structuredClone(description.default);
      loaded.sources[id] = `default:${catalog.namespaces.get(id.slice(0, id.indexOf(".")))}`;
    }
  }
  const env: PguideConfig = {};
  if (process.env.PGUIDE_FORMAT !== undefined) env["cli-core.format"] = process.env.PGUIDE_FORMAT;
  if (process.env.PGUIDE_LANGUAGE !== undefined)
    env["cli-core.defaultLanguage"] = process.env.PGUIDE_LANGUAGE;
  if (process.env.PGUIDE_STATE_DIRECTORY !== undefined)
    env["cli-core.stateDirectory"] = process.env.PGUIDE_STATE_DIRECTORY;
  merge(env, "environment");
  return requireSettings(loaded, namespaces);
}

export function setting<T>(config: PguideConfig, id: string): T | undefined {
  return config[id] as T | undefined;
}

export function requiredSetting<T>(config: PguideConfig, id: string): T {
  if (!Object.hasOwn(config, id)) throw new CliError(`Required setting is missing: ${id}.`);
  return config[id] as T;
}
