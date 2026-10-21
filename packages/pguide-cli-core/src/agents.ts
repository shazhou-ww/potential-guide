import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import {
  type AgentProfile,
  atomicWrite,
  CliError,
  userConfigPath,
  validateAgentProfile,
} from "./index.js";

export const AGENTS_SCHEMA = "https://shazhou-ww.github.io/potential-guide/schemas/agents/v1.json";
const require = createRequire(import.meta.url);
const yaml = (): typeof import("yaml") => require("yaml");
export interface AgentsFile {
  $schema: typeof AGENTS_SCHEMA;
  agents: Record<string, AgentProfile>;
}
export interface LoadedAgents {
  agents: Record<string, AgentProfile>;
  sources: Record<string, { scope: "user" | "project"; path: string }>;
  paths: { user: string; project: string };
}
export function validateAgentName(name: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new CliError(`Invalid agent name: ${name}.`);
}
export function parseAgents(source: string): AgentsFile {
  const document = yaml().parseDocument(source, { uniqueKeys: true });
  if (document.errors.length)
    throw new CliError(
      "Invalid agents YAML; duplicate keys and malformed documents are not allowed.",
    );
  const value: unknown = document.toJS({ maxAliasCount: 100 });
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CliError("Agents file must be an object.");
  const raw = value as Record<string, unknown>;
  if (raw.$schema !== AGENTS_SCHEMA)
    throw new CliError(
      `Agents file $schema must be ${AGENTS_SCHEMA}; unknown schemas are never fetched.`,
    );
  if (Object.keys(raw).some((key) => key !== "$schema" && key !== "agents"))
    throw new CliError("Agents file supports only $schema and agents.");
  if (!raw.agents || typeof raw.agents !== "object" || Array.isArray(raw.agents))
    throw new CliError("agents must be a name-to-profile map.");
  const agents: Record<string, AgentProfile> = {};
  for (const [name, profile] of Object.entries(raw.agents)) {
    validateAgentName(name);
    if (!profile || typeof profile !== "object" || !Object.hasOwn(profile, "type"))
      throw new CliError(
        "Agent resources require canonical type: acp|ahp. Use pguide agents migrate for embedded legacy profiles.",
      );
    Object.defineProperty(agents, name, {
      value: validateAgentProfile(profile),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { $schema: AGENTS_SCHEMA, agents };
}
export function emptyAgents(): AgentsFile {
  return { $schema: AGENTS_SCHEMA, agents: {} };
}
export async function resourceText(path: string): Promise<string | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new CliError(`Resource must be a regular non-symlink file: ${path}.`);
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function agentsPaths(cwd: string): Promise<LoadedAgents["paths"]> {
  let current = resolve(cwd);
  let resourceDirectory: string | undefined;
  while (true) {
    const directory = join(current, ".pguide");
    // Retired main files still anchor resource rescue; their values are never loaded here.
    const mainExists = (
      await Promise.all(
        ["config.jsonc", "config.yaml"].map((name) =>
          stat(join(directory, name)).then(
            (info) => info.isFile(),
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return false;
              throw error;
            },
          ),
        ),
      )
    ).some(Boolean);
    if (mainExists) {
      return {
        user: join(dirname(userConfigPath()), "agents.yaml"),
        project: join(directory, "agents.yaml"),
      };
    }
    if (resourceDirectory === undefined) {
      const resourceExists = await stat(join(directory, "agents.yaml")).then(
        (info) => info.isFile(),
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      if (resourceExists) resourceDirectory = directory;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return {
    user: join(dirname(userConfigPath()), "agents.yaml"),
    project: join(resourceDirectory ?? join(resolve(cwd), ".pguide"), "agents.yaml"),
  };
}
export async function loadAgents(cwd: string): Promise<LoadedAgents> {
  const paths = await agentsPaths(cwd);
  const result: LoadedAgents = { agents: Object.create(null), sources: Object.create(null), paths };
  for (const scope of ["user", "project"] as const) {
    const path = paths[scope];
    const source = await resourceText(path);
    if (source === undefined) continue;
    for (const [name, profile] of Object.entries(parseAgents(source).agents)) {
      Object.defineProperty(result.agents, name, {
        value: profile,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(result.sources, name, {
        value: { scope, path },
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return result;
}

// Cooperative writers lock both migration endpoints in a stable order. Snapshots also
// detect edits by editors which do not participate in this lock protocol.
export async function withResourceLocks<T>(paths: string[], action: () => Promise<T>): Promise<T> {
  const held: { path: string; handle: Awaited<ReturnType<typeof open>> }[] = [];
  try {
    for (const path of [...new Set(paths.map((entry) => resolve(entry)))].sort()) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const lock = `${path}.lock`;
      try {
        held.push({ path: lock, handle: await open(lock, "wx", 0o600) });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new CliError(
            `Resource is locked: ${path}. Retry after the other writer completes; inspect stale locks manually.`,
          );
        throw error;
      }
    }
    return await action();
  } finally {
    for (const item of held.reverse()) {
      await item.handle.close();
      await unlink(item.path);
    }
  }
}
export async function writeAgents(
  path: string,
  file: AgentsFile,
  expected: string | undefined,
): Promise<void> {
  const content = yaml().stringify(file);
  parseAgents(content);
  if ((await resourceText(path)) !== expected)
    throw new CliError(`Concurrent edit detected: ${path}. No changes written.`);
  await atomicWrite(path, content);
}
export async function migrateAgents(
  cwd: string,
  scope: "user" | "project",
  sourcePath?: string,
): Promise<{ source: string; destination: string; backup: string; names: string[] }> {
  const paths = await agentsPaths(cwd);
  const destination = paths[scope];
  const source = resolve(sourcePath ?? join(dirname(destination), "config.yaml"));
  const directoryKey = (path: string) =>
    process.platform === "win32" ? dirname(path).toLowerCase() : dirname(path);
  if (directoryKey(source) !== directoryKey(destination))
    throw new CliError(
      "Migration source must be the main config beside the selected scope's agents.yaml; --config is not an agents scope.",
    );
  return withResourceLocks([source, destination], async () => {
    const original = await resourceText(source);
    if (original === undefined) throw new CliError(`Migration source not found: ${source}.`);
    const document = yaml().parseDocument(original, { uniqueKeys: true });
    if (document.errors.length) throw new CliError("Migration source is malformed YAML.");
    const raw: unknown = document.toJS({ maxAliasCount: 100 });
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Object.hasOwn(raw, "agents"))
      throw new CliError("Migration source has no embedded agents.");
    const legacy = (raw as Record<string, unknown>).agents;
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy))
      throw new CliError("Embedded agents must be a name-to-profile map.");
    const profiles = parseAgents(
      yaml().stringify({
        $schema: AGENTS_SCHEMA,
        agents: Object.fromEntries(
          Object.entries(legacy).map(([name, profile]) => [name, validateAgentProfile(profile)]),
        ),
      }),
    );
    const before = await resourceText(destination);
    const target = before === undefined ? emptyAgents() : parseAgents(before);
    for (const name of Object.keys(profiles.agents)) {
      if (Object.hasOwn(target.agents, name))
        throw new CliError(
          `Migration conflict: ${name} already exists in ${destination}. Resolve explicitly; no files changed.`,
        );
    }
    const next = { ...target, agents: { ...target.agents, ...profiles.agents } };
    document.delete("agents");
    const main = document.toString();
    const backup = `${source}.agents-migration.${randomUUID()}.bak`;
    // Exact source evidence is durable before either endpoint changes. Unknown
    // main-config fields and comments are retained by editing the YAML document.
    const evidence = await open(backup, "wx", 0o600);
    try {
      await evidence.writeFile(original, "utf8");
    } finally {
      await evidence.close();
    }
    if ((await resourceText(source)) !== original)
      throw new CliError("Concurrent source edit detected; migration cancelled.");
    await writeAgents(destination, next, before);
    try {
      if ((await resourceText(source)) !== original)
        throw new CliError("Concurrent source edit detected; source preserved.");
      await atomicWrite(source, main);
    } catch (error) {
      // A post-rename filesystem error must not remove the only live copy of
      // profiles if the main document has already committed its removal.
      if ((await resourceText(source)) !== original) throw error;
      const written = yaml().stringify(next);
      if ((await resourceText(destination)) === written) {
        if (before === undefined) await unlink(destination);
        else await atomicWrite(destination, before);
      }
      throw error;
    }
    return { source, destination, backup, names: Object.keys(profiles.agents) };
  });
}
