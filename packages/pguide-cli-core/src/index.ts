import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parse, stringify } from "yaml";
import { parseRegulationPermissions, type RegulationPermissions } from "./permissions.js";
import { killProcessTree } from "./process-tree.js";
import { pipeRedactedSecrets } from "./streaming-secret-redactor.js";

export { type AhpSessionIdentity, executeAhp, inspectAhp } from "./ahp.js";
export { type CommandHelp, formatCommandHelp } from "./help.js";
export {
  type PermissionGrant,
  parseRegulationPermissions,
  type RegulationPermissions,
} from "./permissions.js";
export { killProcessTree } from "./process-tree.js";

export const COMMAND_PROTOCOL = "pguide-command-v1";

export interface CommandMetadata {
  protocol: typeof COMMAND_PROTOCOL;
  command: string;
  description: string;
  version: string;
}

export interface LegacyAcpAgentProfile {
  connection: { type: "acp"; protocolVersion: string };
  transport: { type: "stdio"; command: string; args?: string[]; env?: string[] };
  requirements?: { sessionResume?: boolean };
}

export interface AcpAgentProfile {
  type: "acp";
  connection: { protocolVersion: string };
  transport: LegacyAcpAgentProfile["transport"];
  requirements?: { sessionResume?: boolean };
}

export interface AhpAgentProfile {
  type: "ahp";
  confirmations?: "deny" | "external";
  connection: { protocolVersion: "1.0.0" | "0.9.0"; agent: string };
  transport: { type: "websocket"; url: string };
  authentication?: (
    | { type: "none" }
    | { type: "query-token"; parameter: string; tokenEnv: string }
  ) & { resources?: { resource: string; tokenEnv: string }[] };
  requirements?: { sessionResume?: boolean };
}

export type AgentProfile = AcpAgentProfile | AhpAgentProfile;

export interface PguideConfig {
  schemaVersion: 2;
  defaultAgent?: string;
  commandDirectories?: string[];
  defaultLanguage?: string;
  format?: "markdown" | "json";
  color?: "auto" | "always" | "never";
  logLevel?: "error" | "warn" | "info" | "debug";
  stateDirectory?: string;
  retentionDays?: number;
  agentExecutionLimits?: { timeoutMs?: number };
  regulationPermissions?: RegulationPermissions;
  regulationStrategy?: {
    probe?: { timeoutMs: number; retry: { maxRetries: number; delayMs: number } };
    quota?: { timeoutMs: number; maxAgentRuns: number; maxStallRuns: number };
  };
  agents?: Record<string, AgentProfile>;
  objectives?: Record<string, string>;
}

export interface LoadedConfig {
  value: PguideConfig;
  sources: Record<string, string>;
  paths: { user: string; project?: string; explicit?: string };
}

export interface GlobalOptions {
  cwd: string;
  config?: string;
  format: "markdown" | "json";
  color: "auto" | "always" | "never";
  logLevel: "error" | "warn" | "info" | "debug";
  help: boolean;
  version: boolean;
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 2,
    readonly status = "invalid",
    readonly guidance?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0)
    throw new CliError(`${context} contains unknown fields: ${extra.join(", ")}.`);
}

function positiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new CliError(`${field} must be a positive integer.`);
  }

  return Number(value);
}

export function acpProtocolVersion(value: string): number {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw new CliError("ACP protocolVersion must be a positive safe integer string.");
  }
  return Number(value);
}

const secretName =
  /^(?:api[-_]?key|client[-_]?secret|bearer[-_]?token|authorization|access[-_]?token|refresh[-_]?token|auth[-_]?token|private[-_]?key|credential|token|password|passwd|secret)$/i;

function rejectSecretValues(value: unknown, path: readonly string[] = []): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries())
      rejectSecretValues(entry, [...path, String(index)]);
    return;
  }
  if (!record(value)) {
    if (typeof value === "string" && value !== "" && path.some((part) => secretName.test(part))) {
      throw new CliError("Agent profiles may not contain credential literals.");
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) rejectSecretValues(entry, [...path, key]);
}

function rejectSecretArguments(args: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string;
    const equal = /^--?([^=]+)=(.*)$/.exec(argument);
    if (equal !== null && secretName.test(equal[1] as string) && (equal[2] as string) !== "") {
      throw new CliError("Agent transport args may not contain credential literals.");
    }

    const flag = /^--?(.+)$/.exec(argument);
    if (
      flag !== null &&
      secretName.test(flag[1] as string) &&
      args[index + 1] !== undefined &&
      args[index + 1] !== "--"
    ) {
      throw new CliError("Agent transport args may not contain credential literals.");
    }
  }
}

function redactSecretArguments(args: readonly string[]): string[] {
  const redacted = [...args];
  for (let index = 0; index < redacted.length; index += 1) {
    const argument = redacted[index] as string;
    const equal = /^--?([^=]+)=(.*)$/.exec(argument);
    if (equal !== null && secretName.test(equal[1] as string)) {
      redacted[index] = `${argument.slice(0, argument.indexOf("=") + 1)}[REDACTED]`;
      continue;
    }
    const flag = /^--?(.+)$/.exec(argument);
    if (flag !== null && secretName.test(flag[1] as string) && redacted[index + 1] !== undefined) {
      redacted[index + 1] = "[REDACTED]";
      index += 1;
    }
  }
  return redacted;
}

export function redactSensitive<T>(value: T): T {
  function visit(current: unknown, key?: string): unknown {
    if (key !== undefined && secretName.test(key) && current !== undefined && current !== null) {
      return "[REDACTED]";
    }
    if (Array.isArray(current)) {
      return key === "args"
        ? redactSecretArguments(current.map((entry) => String(entry)))
        : current.map((entry) => visit(entry));
    }
    if (!record(current)) return current;
    return Object.fromEntries(
      Object.entries(current).map(([entryKey, entry]) => [entryKey, visit(entry, entryKey)]),
    );
  }
  return visit(value) as T;
}

export function agentSecretValues(profile: AgentProfile | LegacyAcpAgentProfile): string[] {
  const names =
    "type" in profile && profile.type === "ahp"
      ? [
          ...(profile.authentication?.type === "query-token"
            ? [profile.authentication.tokenEnv]
            : []),
          ...(profile.authentication?.resources?.map(({ tokenEnv }) => tokenEnv) ?? []),
        ]
      : "env" in profile.transport
        ? (profile.transport.env ?? [])
        : [];
  return [
    ...new Set(
      names
        .map((name) => process.env[name])
        .filter((secret): secret is string => secret !== undefined && secret !== ""),
    ),
  ].sort((left, right) => right.length - left.length);
}

export function redactAgentValue<T>(value: T, profile: AgentProfile | LegacyAcpAgentProfile): T {
  const secrets = agentSecretValues(profile);
  const visit = (current: unknown): unknown => {
    if (typeof current === "string") {
      let safe = current;
      for (const secret of secrets) safe = safe.split(secret).join("[REDACTED]");
      return safe;
    }
    if (Array.isArray(current)) return current.map(visit);
    if (record(current))
      return Object.fromEntries(Object.entries(current).map(([key, entry]) => [key, visit(entry)]));
    return current;
  };
  return redactSensitive(visit(value) as T);
}

export function validateAgentProfile(value: unknown): AgentProfile {
  if (!record(value)) throw new CliError("Agent profile must be an object.");
  exactKeys(
    value,
    ["type", "connection", "transport", "authentication", "requirements", "confirmations"],
    "Agent profile",
  );
  if (!record(value.connection)) throw new CliError("Agent connection is required.");
  const legacy = value.type === undefined && value.connection.type === "acp";
  if (!legacy && value.type !== "acp" && value.type !== "ahp")
    throw new CliError("Agent profile must explicitly select type: acp or ahp.");
  if (!legacy && "type" in value.connection)
    throw new CliError(
      "Use only profile-level type; connection.type is reserved for legacy ACP profiles.",
    );
  const type = legacy ? "acp" : value.type;
  if (!record(value.transport)) throw new CliError("Agent transport is required.");
  let requirements: AgentProfile["requirements"];
  if (value.requirements !== undefined) {
    if (!record(value.requirements)) throw new CliError("Agent requirements must be an object.");
    exactKeys(value.requirements, ["sessionResume"], "Agent requirements");
    if (
      value.requirements.sessionResume !== undefined &&
      typeof value.requirements.sessionResume !== "boolean"
    ) {
      throw new CliError("sessionResume must be boolean.");
    }
    requirements =
      value.requirements.sessionResume === undefined
        ? {}
        : { sessionResume: value.requirements.sessionResume };
  }
  rejectSecretValues(value);
  const common = requirements === undefined ? {} : { requirements };
  if (type === "acp") {
    if (value.confirmations !== undefined)
      throw new CliError("ACP profiles do not support AHP confirmations.");
    exactKeys(
      value.connection,
      legacy ? ["type", "protocolVersion"] : ["protocolVersion"],
      "ACP connection",
    );
    if (!nonempty(value.connection.protocolVersion))
      throw new CliError("ACP protocolVersion is required.");
    acpProtocolVersion(value.connection.protocolVersion);
    if (value.authentication !== undefined)
      throw new CliError("ACP authentication must use transport environment names.");
    exactKeys(value.transport, ["type", "command", "args", "env"], "ACP transport");
    if (value.transport.type !== "stdio" || !nonempty(value.transport.command))
      throw new CliError("Agent transport must be stdio with a command.");
    const args = value.transport.args;
    if (args !== undefined && (!Array.isArray(args) || !args.every(nonempty)))
      throw new CliError("Agent transport args must be nonempty strings.");
    rejectSecretArguments(args ?? []);
    const env = value.transport.env;
    if (env !== undefined && (!Array.isArray(env) || !env.every(environmentName)))
      throw new CliError("Agent transport env must contain environment variable names.");
    return {
      type: "acp",
      connection: { protocolVersion: value.connection.protocolVersion },
      transport: {
        type: "stdio",
        command: value.transport.command,
        ...(args === undefined ? {} : { args }),
        ...(env === undefined ? {} : { env }),
      },
      ...common,
    };
  }
  if (
    value.confirmations !== undefined &&
    value.confirmations !== "deny" &&
    value.confirmations !== "external"
  )
    throw new CliError("AHP confirmations must be deny or external.");
  exactKeys(value.connection, ["protocolVersion", "agent"], "AHP connection");
  if (value.connection.protocolVersion !== "1.0.0" && value.connection.protocolVersion !== "0.9.0")
    throw new CliError("AHP protocolVersion must be 1.0.0 or 0.9.0 (supported by SDK 1.0.0).");
  if (!nonempty(value.connection.agent))
    throw new CliError("AHP connection.agent must name an advertised provider.");
  exactKeys(value.transport, ["type", "url"], "AHP transport");
  if (value.transport.type !== "websocket" || !nonempty(value.transport.url))
    throw new CliError("AHP transport must be websocket with a URL.");
  let url: URL;
  try {
    url = new URL(value.transport.url);
  } catch {
    throw new CliError("Invalid AHP WebSocket URL.");
  }
  if (
    !["ws:", "wss:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new CliError(
      "AHP URL must use ws/wss without credentials, query or fragment; use authentication environment references.",
    );
  let authentication: AhpAgentProfile["authentication"];
  if (value.authentication !== undefined) {
    const auth = value.authentication;
    if (!record(auth)) throw new CliError("AHP authentication must be an object.");
    exactKeys(
      auth,
      auth.type === "query-token"
        ? ["type", "parameter", "tokenEnv", "resources"]
        : ["type", "resources"],
      "AHP authentication",
    );
    if (auth.type !== "none" && auth.type !== "query-token")
      throw new CliError("AHP authentication must select none or query-token.");
    const resources: { resource: string; tokenEnv: string }[] = [];
    if (auth.resources !== undefined) {
      if (!Array.isArray(auth.resources))
        throw new CliError("AHP authentication.resources must be an array.");
      for (const entry of auth.resources) {
        if (!record(entry)) throw new CliError("AHP resource credential must be an object.");
        exactKeys(entry, ["resource", "tokenEnv"], "AHP resource credential");
        if (!nonempty(entry.resource) || !environmentName(entry.tokenEnv))
          throw new CliError("AHP resource credentials require resource and tokenEnv.");
        if (resources.some(({ resource }) => resource === entry.resource))
          throw new CliError("Duplicate AHP resource credential.");
        resources.push({ resource: entry.resource, tokenEnv: entry.tokenEnv });
      }
    }
    if (auth.type === "query-token") {
      if (
        !nonempty(auth.parameter) ||
        !/^[A-Za-z][A-Za-z0-9_-]*$/.test(auth.parameter) ||
        !environmentName(auth.tokenEnv)
      )
        throw new CliError("AHP query-token requires a parameter name and tokenEnv.");
      authentication = {
        type: auth.type,
        parameter: auth.parameter,
        tokenEnv: auth.tokenEnv,
        ...(auth.resources === undefined ? {} : { resources }),
      };
    } else
      authentication = { type: "none", ...(auth.resources === undefined ? {} : { resources }) };
  }
  return {
    type: "ahp",
    connection: {
      protocolVersion: value.connection.protocolVersion,
      agent: value.connection.agent,
    },
    transport: { type: "websocket", url: url.href },
    ...common,
    ...(value.confirmations === undefined ? {} : { confirmations: value.confirmations }),
    ...(authentication === undefined ? {} : { authentication }),
  };
}

function environmentName(value: unknown): value is string {
  return nonempty(value) && /^[A-Z_][A-Z0-9_]*$/.test(value);
}

export function parseConfig(source: string): PguideConfig {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    throw new CliError(`Invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!record(raw)) throw new CliError("Configuration must be an object.");
  if (raw.schemaVersion === 1 || raw.limits !== undefined) {
    throw new CliError(
      "Legacy configuration is incompatible. Use schemaVersion: 2 and agentExecutionLimits.timeoutMs; cross-round iteration and stalled budgets are no longer supported.",
    );
  }
  exactKeys(
    raw,
    [
      "schemaVersion",
      "defaultAgent",
      "commandDirectories",
      "defaultLanguage",
      "format",
      "color",
      "logLevel",
      "stateDirectory",
      "retentionDays",
      "agentExecutionLimits",
      "regulationPermissions",
      "regulationStrategy",
      "agents",
      "objectives",
    ],
    "Configuration",
  );
  if (raw.schemaVersion !== 2) throw new CliError("Configuration schemaVersion must be 2.");
  for (const field of ["defaultAgent", "defaultLanguage", "stateDirectory"] as const) {
    if (raw[field] !== undefined && !nonempty(raw[field])) {
      throw new CliError(`${field} must be a nonempty string.`);
    }
  }
  if (
    raw.commandDirectories !== undefined &&
    (!Array.isArray(raw.commandDirectories) || !raw.commandDirectories.every(nonempty))
  ) {
    throw new CliError("commandDirectories must be an array of paths.");
  }
  if (raw.format !== undefined && raw.format !== "markdown" && raw.format !== "json") {
    throw new CliError("format must be markdown or json.");
  }
  if (
    raw.color !== undefined &&
    raw.color !== "auto" &&
    raw.color !== "always" &&
    raw.color !== "never"
  ) {
    throw new CliError("color must be auto, always, or never.");
  }
  if (
    raw.logLevel !== undefined &&
    !["error", "warn", "info", "debug"].includes(String(raw.logLevel))
  ) {
    throw new CliError("logLevel is invalid.");
  }
  positiveInteger(raw.retentionDays, "retentionDays");
  if (raw.regulationPermissions !== undefined) {
    try {
      parseRegulationPermissions(raw.regulationPermissions);
    } catch {
      throw new CliError(
        "Invalid regulationPermissions: require explicit unique rules and grants within the ceiling.",
      );
    }
  }
  if (raw.agentExecutionLimits !== undefined) {
    if (!record(raw.agentExecutionLimits))
      throw new CliError("agentExecutionLimits must be an object.");
    exactKeys(raw.agentExecutionLimits, ["timeoutMs"], "agentExecutionLimits");
    const timeoutMs = positiveInteger(
      raw.agentExecutionLimits.timeoutMs,
      "agentExecutionLimits.timeoutMs",
    );
    if (timeoutMs !== undefined && timeoutMs > 2_147_483_647)
      throw new CliError("agentExecutionLimits.timeoutMs must not exceed 2147483647.");
  }
  if (raw.regulationStrategy !== undefined) {
    const strategy = raw.regulationStrategy;
    if (!record(strategy)) throw new CliError("regulationStrategy must be an object.");
    exactKeys(strategy, ["probe", "quota"], "regulationStrategy");
    const timer = (value: unknown, field: string, allowZero = false): void => {
      if (
        !Number.isSafeInteger(value) ||
        Number(value) < (allowZero ? 0 : 1) ||
        Number(value) > 2_147_483_647
      )
        throw new CliError(
          `${field} must be an integer between ${allowZero ? 0 : 1} and 2147483647.`,
        );
    };
    if (strategy.quota !== undefined) {
      if (!record(strategy.quota))
        throw new CliError("regulationStrategy.quota must be an object.");
      exactKeys(
        strategy.quota,
        ["timeoutMs", "maxAgentRuns", "maxStallRuns"],
        "regulationStrategy.quota",
      );
      timer(strategy.quota.timeoutMs, "regulationStrategy.quota.timeoutMs");
      for (const key of ["maxAgentRuns", "maxStallRuns"]) {
        if (!Number.isSafeInteger(strategy.quota[key]) || Number(strategy.quota[key]) < 1)
          throw new CliError(`regulationStrategy.quota.${key} must be a positive safe integer.`);
      }
    }
    if (strategy.probe !== undefined) {
      if (!record(strategy.probe))
        throw new CliError("regulationStrategy.probe must be an object.");
      exactKeys(strategy.probe, ["timeoutMs", "retry"], "regulationStrategy.probe");
      timer(strategy.probe.timeoutMs, "regulationStrategy.probe.timeoutMs");
      if (!record(strategy.probe.retry))
        throw new CliError("regulationStrategy.probe.retry is required.");
      exactKeys(strategy.probe.retry, ["maxRetries", "delayMs"], "regulationStrategy.probe.retry");
      if (
        !Number.isSafeInteger(strategy.probe.retry.maxRetries) ||
        Number(strategy.probe.retry.maxRetries) < 0
      )
        throw new CliError(
          "regulationStrategy.probe.retry.maxRetries must be a nonnegative integer.",
        );
      timer(strategy.probe.retry.delayMs, "regulationStrategy.probe.retry.delayMs", true);
    }
  }
  if (raw.agents !== undefined) {
    if (!record(raw.agents)) throw new CliError("agents must be an object.");
    for (const [name, profile] of Object.entries(raw.agents)) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new CliError(`Invalid agent name: ${name}.`);
      raw.agents[name] = validateAgentProfile(profile);
    }
  }
  if (raw.objectives !== undefined) {
    if (!record(raw.objectives)) throw new CliError("objectives must be an object.");
    for (const [name, location] of Object.entries(raw.objectives)) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
        throw new CliError(`Invalid Objective name: ${name}.`);
      if (!nonempty(location) || location.startsWith("@"))
        throw new CliError(
          `Objective ${name} must reference a path or Git URI, not another registry entry.`,
        );
    }
  }
  return raw as unknown as PguideConfig;
}

export function userConfigPath(): string {
  if (platform() === "win32") {
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "pguide",
      "config.yaml",
    );
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "pguide", "config.yaml");
}

export function stateRoot(config?: PguideConfig): string {
  if (config?.stateDirectory !== undefined) return resolve(config.stateDirectory);
  if (platform() === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "pguide");
  }
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "pguide");
}

async function existingProjectConfig(cwd: string): Promise<string | undefined> {
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, ".pguide", "config.yaml");
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function readOptional(path: string): Promise<PguideConfig | undefined> {
  try {
    return parseConfig(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function mergeConfig(
  target: PguideConfig,
  incoming: PguideConfig,
  source: string,
  sources: Record<string, string>,
): PguideConfig {
  const next = { ...target, ...incoming };
  if (incoming.agentExecutionLimits !== undefined)
    next.agentExecutionLimits = {
      ...target.agentExecutionLimits,
      ...incoming.agentExecutionLimits,
    };
  if (incoming.regulationStrategy !== undefined)
    next.regulationStrategy = { ...target.regulationStrategy, ...incoming.regulationStrategy };
  if (incoming.agents !== undefined) next.agents = { ...target.agents, ...incoming.agents };
  if (incoming.objectives !== undefined)
    next.objectives = { ...target.objectives, ...incoming.objectives };
  for (const key of Object.keys(incoming)) sources[key] = source;
  for (const name of Object.keys(incoming.agents ?? {})) sources[`agents.${name}`] = source;
  for (const name of Object.keys(incoming.objectives ?? {})) sources[`objectives.${name}`] = source;
  return next;
}

export async function loadConfig(cwd: string, explicit?: string): Promise<LoadedConfig> {
  const user = userConfigPath();
  const project = await existingProjectConfig(cwd);
  let value: PguideConfig = { schemaVersion: 2 };
  const sources: Record<string, string> = { schemaVersion: "built-in" };
  for (const path of [user, project, explicit].filter(
    (entry): entry is string => entry !== undefined,
  )) {
    const layer = await readOptional(resolve(path));
    if (layer === undefined && path === explicit) throw new CliError(`Config not found: ${path}.`);
    if (layer !== undefined) value = mergeConfig(value, layer, resolve(path), sources);
  }
  const env: Partial<PguideConfig> = {};
  if (process.env.PGUIDE_FORMAT !== undefined) env.format = process.env.PGUIDE_FORMAT as "json";
  if (process.env.PGUIDE_LANGUAGE !== undefined) env.defaultLanguage = process.env.PGUIDE_LANGUAGE;
  if (process.env.PGUIDE_STATE_DIRECTORY !== undefined) {
    env.stateDirectory = process.env.PGUIDE_STATE_DIRECTORY;
  }
  if (Object.keys(env).length > 0) {
    value = mergeConfig(value, env as PguideConfig, "environment", sources);
  }
  return {
    value: parseConfig(stringify({ ...value, schemaVersion: 2 })),
    sources,
    paths: {
      user,
      ...(project === undefined ? {} : { project }),
      ...(explicit ? { explicit } : {}),
    },
  };
}

export function redactConfig(config: PguideConfig): PguideConfig {
  return redactSensitive(config);
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, absolute);
    if (platform() !== "win32") await chmod(absolute, 0o600);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let source = "";
  for await (const chunk of process.stdin) source += chunk;
  return source;
}

export function resolveObjective(location: string, config: PguideConfig): string {
  const name = location.startsWith("@") ? location.slice(1) : location;
  const objectives = config.objectives;
  if (objectives !== undefined && Object.hasOwn(objectives, name))
    return objectives[name] as string;
  if (location.startsWith("@")) throw new CliError(`Unknown registered Objective: ${name}.`);
  return location;
}

export async function readJsonSubject(
  path: string | undefined,
  cwd: string,
  subjectSchema?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const missingSubject = (message: string) =>
    new CliError(
      message,
      2,
      "invalid",
      subjectSchema === undefined
        ? undefined
        : {
            instructions:
              "Create a JSON object matching subjectSchema below. Save it to subject.json and pass --subject-file subject.json, or pipe the JSON object to stdin. The schema is guidance, not a subject to submit.",
            subjectSchema,
          },
    );
  if ((path === undefined || path === "-") && process.stdin.isTTY)
    throw missingSubject("Pipe a JSON subject to stdin or provide --subject-file <path>.");
  const source =
    path === undefined || path === "-"
      ? await readStdin()
      : await readFile(resolve(cwd, path), "utf8");
  if (source.trim() === "")
    throw missingSubject(
      "Subject must be valid JSON. Pipe a JSON subject to stdin or provide --subject-file <path>.",
    );
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new CliError("Subject must be valid JSON.");
  }
  if (!record(value)) throw new CliError("Subject must be a JSON object.");
  return value;
}

const globalValues = new Set(["--cwd", "--config", "--format", "--color", "--log-level"]);

export function extractGlobals(argv: readonly string[]): {
  options: GlobalOptions;
  rest: string[];
} {
  const rest: string[] = [];
  const values: Record<string, string> = {};
  let help = false;
  let version = false;
  let stopped = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (argument === "--") {
      stopped = true;
      rest.push(argument);
      continue;
    }
    if (!stopped && globalValues.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined) throw new CliError(`${argument} requires a value.`);
      values[argument] = value;
      index += 1;
    } else if (!stopped && argument === "--help") {
      help = true;
    } else if (!stopped && argument === "--version") {
      version = true;
    } else {
      rest.push(argument);
    }
  }
  const format = values["--format"] ?? "markdown";
  const color = values["--color"] ?? "auto";
  const logLevel = values["--log-level"] ?? "warn";
  if (format !== "markdown" && format !== "json") throw new CliError("Invalid --format.");
  if (!["auto", "always", "never"].includes(color)) throw new CliError("Invalid --color.");
  if (!["error", "warn", "info", "debug"].includes(logLevel)) {
    throw new CliError("Invalid --log-level.");
  }
  return {
    options: {
      cwd: resolve(values["--cwd"] ?? process.cwd()),
      ...(values["--config"] === undefined ? {} : { config: resolve(values["--config"]) }),
      format,
      color: color as GlobalOptions["color"],
      logLevel: logLevel as GlobalOptions["logLevel"],
      help,
      version,
    },
    rest,
  };
}

export function option(
  argv: readonly string[],
  name: string,
  options: { required?: boolean; multiple?: boolean } = {},
): string | string[] | undefined {
  const found: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new CliError(`${name} needs a value.`);
      found.push(value);
      index += 1;
    }
  }
  if (options.required && found.length === 0) throw new CliError(`${name} is required.`);
  return options.multiple ? found : found.at(-1);
}

export function duration(value: string): number {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value);
  if (match === null) throw new CliError(`Invalid duration: ${value}.`);
  const amount = Number(match[1]);
  return amount * { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2] as "ms"];
}

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function rejectUnknownOptions(
  argv: readonly string[],
  options: Readonly<Record<string, "flag" | "value">>,
  positional = 0,
): void {
  let positionals = 0;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (!argument.startsWith("--")) {
      positionals += 1;
      continue;
    }
    const kind = options[argument];
    if (kind === undefined) throw new CliError(`Unknown option: ${argument}.`);
    if (kind === "value") {
      if (argv[index + 1] === undefined || String(argv[index + 1]).startsWith("--")) {
        throw new CliError(`${argument} needs a value.`);
      }
      index += 1;
    }
  }
  if (positionals > positional) throw new CliError("Too many positional arguments.");
}

function inside(root: string, candidate: string): boolean {
  const prefix =
    root.endsWith("\\") || root.endsWith("/")
      ? root
      : `${root}${process.platform === "win32" ? "\\" : "/"}`;
  const normalize = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
  return normalize(candidate).startsWith(normalize(prefix));
}

export async function pruneExpiredRegulations(root: string, now = new Date()): Promise<number> {
  const regulations = join(resolve(root), "regulations");
  let canonicalRoot: string;
  try {
    if ((await lstat(regulations)).isSymbolicLink()) {
      throw new CliError("Regulations state root may not be a symbolic link.", 6, "io-error");
    }
    canonicalRoot = await realpath(regulations);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  let removed = 0;
  for (const name of await readdir(canonicalRoot)) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(name))
      continue;
    const candidate = join(canonicalRoot, name);
    const details = await lstat(candidate);
    if (details.isSymbolicLink() || !details.isDirectory()) continue;
    const canonical = await realpath(candidate);
    if (!inside(canonicalRoot, canonical)) continue;
    let expiresAt: unknown;
    try {
      expiresAt = (
        JSON.parse(await readFile(join(canonical, "regulation.json"), "utf8")) as Record<
          string,
          unknown
        >
      ).expiresAt;
    } catch {
      continue;
    }
    if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) continue;
    if (Date.parse(expiresAt) >= now.getTime()) continue;
    await rm(canonical, { recursive: true });
    removed += 1;
  }
  return removed;
}

export function writeResult(
  value: Record<string, unknown>,
  format: "markdown" | "json",
  markdown: string,
): void {
  process.stdout.write(format === "json" ? `${JSON.stringify(value, null, 2)}\n` : `${markdown}\n`);
}

export function expectedCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const nodeError = error as NodeJS.ErrnoException;
  if (
    error instanceof SyntaxError ||
    (typeof nodeError?.code === "string" &&
      ["EACCES", "EEXIST", "EISDIR", "ENOENT", "ENOTDIR", "EPERM", "EPIPE"].includes(
        nodeError.code,
      ))
  ) {
    return new CliError(error instanceof Error ? error.message : String(error), 6, "io-error");
  }
  return new CliError(error instanceof Error ? error.message : String(error), 70, "internal-error");
}

export async function commandMain(
  metadata: CommandMetadata,
  run: (argv: string[], globals: GlobalOptions) => Promise<number | undefined> | Promise<void>,
): Promise<void> {
  try {
    if (process.argv[2] === "--pguide-command-metadata") {
      process.stdout.write(`${JSON.stringify(metadata)}\n`);
      return;
    }
    const { options, rest } = extractGlobals(process.argv.slice(2));
    if (options.version) {
      writeResult(
        { schemaVersion: 1, command: metadata.command, version: metadata.version },
        options.format,
        `${metadata.command} ${metadata.version}`,
      );
      return;
    }
    process.exitCode = (await run(rest, options)) ?? 0;
  } catch (error) {
    const failure = expectedCliError(error);
    const format =
      process.argv.includes("--format") &&
      process.argv[process.argv.indexOf("--format") + 1] === "json"
        ? "json"
        : "markdown";
    writeResult(
      {
        schemaVersion: 1,
        status: failure.status,
        error: failure.message,
        ...(failure.guidance === undefined ? {} : { guidance: failure.guidance }),
      },
      format,
      `Error: ${failure.message}${
        failure.guidance === undefined
          ? ""
          : `\n\nSubject input guidance:\n\n\`\`\`json\n${JSON.stringify(failure.guidance, null, 2)}\n\`\`\``
      }`,
    );
    process.exitCode = failure.exitCode;
  }
}

interface RpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export interface AcpUpdate {
  timestamp: string;
  method: string;
  params: unknown;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: Record<string, unknown>;
  options: {
    optionId: string;
    name: string;
    kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
  }[];
}

export interface AcpClientOptions {
  maxOutputBytes?: number;
  requireEndTurn?: boolean;
  permissionHandler?: (
    request: AcpPermissionRequest,
    signal: AbortSignal,
  ) => string | undefined | Promise<string | undefined>;
  permissionTimeoutMs?: number;
}

export class AcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private nextId = 1;
  private readonly updateWork = new Set<Promise<void>>();
  private readonly closed: Promise<void>;
  private readonly stderrPipeline: Promise<void>;
  private terminalError?: Error;
  private readonly lifetime = new AbortController();
  private readonly promptText = new Map<string, { text: string; bytes: number }>();
  readonly updates: AcpUpdate[] = [];

  constructor(
    profile: AcpAgentProfile | LegacyAcpAgentProfile,
    private readonly onUpdate: (update: AcpUpdate) => Promise<void> = async () => undefined,
    private readonly options: AcpClientOptions = {},
  ) {
    acpProtocolVersion(profile.connection.protocolVersion);
    if (
      options.maxOutputBytes !== undefined &&
      (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 1)
    )
      throw new CliError("ACP maxOutputBytes must be a positive safe integer.");
    if (
      options.permissionTimeoutMs !== undefined &&
      (!Number.isSafeInteger(options.permissionTimeoutMs) ||
        options.permissionTimeoutMs <= 0 ||
        options.permissionTimeoutMs > 30_000)
    )
      throw new CliError("ACP permissionTimeoutMs must be between 1 and 30000.");
    const environment: NodeJS.ProcessEnv = {};
    for (const name of profile.transport.env ?? []) {
      if (process.env[name] !== undefined) environment[name] = process.env[name];
    }
    environment.PATH = process.env.PATH;
    if (platform() === "win32") {
      environment.SystemRoot = process.env.SystemRoot;
      environment.ComSpec = process.env.ComSpec;
    }
    this.child = spawn(profile.transport.command, profile.transport.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: environment,
      windowsHide: true,
      shell: false,
    });
    let outputBytes = 0;
    const countOutput = (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (options.maxOutputBytes !== undefined && outputBytes > options.maxOutputBytes)
        this.fail(new CliError("ACP output limit exceeded.", 6, "acp-error"));
    };
    this.child.stdout.on("data", countOutput);
    this.child.stderr.on("data", countOutput);
    this.stderrPipeline = pipeRedactedSecrets(
      this.child.stderr,
      process.stderr,
      agentSecretValues(profile),
    ).completion;
    void this.stderrPipeline.catch((error: unknown) =>
      this.fail(error instanceof Error ? error : new Error("ACP stderr pipeline failed.")),
    );
    this.child.on("error", (error) => this.fail(error));
    this.child.stdin.on("error", (error) => this.fail(error));
    this.closed = new Promise((resolveClosed) => {
      this.child.once("close", () => resolveClosed());
    });
    this.child.on("close", (code) => {
      this.fail(new Error(`ACP Agent exited before replying (${String(code)}).`));
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      void this.receive(line).catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error("ACP update handling failed.");
        for (const pending of this.pending.values()) pending.reject(failure);
        this.pending.clear();
      });
    });
  }

  private fail(error: Error): void {
    this.terminalError ??= error;
    this.lifetime.abort(this.terminalError);
    for (const pending of this.pending.values()) pending.reject(this.terminalError);
    this.pending.clear();
  }

  private async receive(line: string): Promise<void> {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }
    if (!record(message) || message.jsonrpc !== "2.0") return;
    if (typeof message.method === "string" && message.id !== undefined) {
      if (typeof message.id !== "string" && !Number.isSafeInteger(message.id)) return;
      await this.handleRequest({ ...message, id: message.id });
      return;
    }
    if (message.id !== undefined) {
      const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
      if (pending !== undefined) {
        this.pending.delete(message.id as number);
        if (message.error !== undefined)
          pending.reject(new Error(message.error.message ?? "ACP error"));
        else pending.resolve(message.result);
      }
      return;
    }
    if (message.method !== undefined) {
      const params = message.params;
      if (
        message.method === "session/update" &&
        record(params) &&
        typeof params.sessionId === "string" &&
        record(params.update) &&
        params.update.sessionUpdate === "agent_message_chunk" &&
        record(params.update.content) &&
        params.update.content.type === "text" &&
        typeof params.update.content.text === "string"
      ) {
        const output = this.promptText.get(params.sessionId);
        if (output !== undefined) {
          output.bytes += Buffer.byteLength(params.update.content.text);
          if (output.bytes > 1_048_576) {
            this.fail(new CliError("ACP Agent text output limit exceeded.", 6, "acp-error"));
            return;
          }
          output.text += params.update.content.text;
        }
      }
      await this.emitUpdate(message.method, message.params);
    }
  }

  private async emitUpdate(method: string, params: unknown): Promise<void> {
    const update = {
      timestamp: new Date().toISOString(),
      method,
      params,
    };
    this.updates.push(update);
    const work = this.onUpdate(update);
    this.updateWork.add(work);
    try {
      await work;
    } finally {
      this.updateWork.delete(work);
    }
  }

  private reply(message: RpcMessage): void {
    if (this.terminalError !== undefined || !this.child.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) this.fail(error);
    });
  }

  private async handleRequest(message: RpcMessage & { id: number | string }): Promise<void> {
    if (message.method !== "session/request_permission") {
      this.reply({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Client method not supported." },
      });
      await this.emitUpdate("pguide/request_denied", { reason: "unsupported-client-method" });
      return;
    }
    const params = message.params;
    let optionId: string | undefined;
    let reason = "no-permission-handler";
    if (
      record(params) &&
      nonempty(params.sessionId) &&
      this.promptText.has(params.sessionId) &&
      record(params.toolCall) &&
      nonempty(params.toolCall.toolCallId) &&
      Array.isArray(params.options) &&
      params.options.length > 0 &&
      params.options.length <= 32 &&
      params.options.every(
        (option) =>
          record(option) &&
          nonempty(option.optionId) &&
          nonempty(option.name) &&
          ["allow_once", "allow_always", "reject_once", "reject_always"].includes(
            String(option.kind),
          ),
      ) &&
      new Set(params.options.map((option) => option.optionId)).size === params.options.length
    ) {
      if (this.options.permissionHandler !== undefined) {
        const offeredIds = new Set(params.options.map((option) => option.optionId));
        const sessionId = params.sessionId;
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, this.lifetime.signal]);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        try {
          const cancelled = new Promise<undefined>((resolveCancelled) => {
            onAbort = () => resolveCancelled(undefined);
            signal.addEventListener("abort", onAbort, { once: true });
            if (signal.aborted) onAbort();
            timeout = setTimeout(
              () => controller.abort(),
              this.options.permissionTimeoutMs ?? 1000,
            );
          });
          const selected = await Promise.race([
            Promise.resolve().then(() =>
              signal.aborted
                ? undefined
                : this.options.permissionHandler?.(
                    params as unknown as AcpPermissionRequest,
                    signal,
                  ),
            ),
            cancelled,
          ]);
          if (!signal.aborted && this.promptText.has(sessionId) && offeredIds.has(selected))
            optionId = selected;
          reason = signal.aborted ? "permission-handler-cancelled" : "permission-not-selected";
        } catch {
          reason = "permission-handler-failed";
        } finally {
          clearTimeout(timeout);
          if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
        }
      }
    } else reason = "invalid-permission-request";
    this.reply({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        outcome:
          optionId === undefined ? { outcome: "cancelled" } : { outcome: "selected", optionId },
      },
    });
    if (optionId === undefined) await this.emitUpdate("pguide/request_denied", { reason });
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      if (
        this.terminalError !== undefined ||
        this.child.stdin.destroyed ||
        this.child.stdin.writableEnded ||
        !this.child.stdin.writable
      ) {
        rejectRequest(this.terminalError ?? new Error("ACP Agent stdin is not writable."));
        return;
      }
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      try {
        this.child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
          (error) => {
            if (error === null || error === undefined) return;
            const pending = this.pending.get(id);
            if (pending !== undefined) {
              this.pending.delete(id);
              pending.reject(error);
            }
            this.fail(error);
          },
        );
      } catch (error) {
        this.pending.delete(id);
        const failure = error instanceof Error ? error : new Error("ACP Agent write failed.");
        this.fail(failure);
        rejectRequest(failure);
      }
    });
  }

  async initialize(protocolVersion: string): Promise<Record<string, unknown>> {
    const version = acpProtocolVersion(protocolVersion);
    const result = await this.request("initialize", {
      protocolVersion: version,
      clientInfo: { name: "pguide", version: "0.1.0" },
      clientCapabilities: {},
    });
    if (!record(result))
      throw new CliError("ACP initialize returned an invalid response.", 6, "acp-error");
    if (!Number.isSafeInteger(result.protocolVersion) || result.protocolVersion !== version)
      throw new CliError(
        "ACP protocol negotiation selected an unsupported version.",
        6,
        "acp-error",
      );
    return result;
  }

  async newSession(cwd: string): Promise<string> {
    const result = await this.request("session/new", { cwd, mcpServers: [] });
    if (!record(result) || !nonempty(result.sessionId)) {
      throw new CliError("ACP session/new returned no sessionId.", 6, "acp-error");
    }
    return result.sessionId;
  }

  async resumeSession(sessionId: string, cwd: string): Promise<void> {
    await this.request("session/load", { sessionId, cwd, mcpServers: [] });
  }

  async prompt(
    sessionId: string,
    prompt: string,
  ): Promise<{ status: "completed" | "blocked" | "cancelled"; summary: string }> {
    if (this.promptText.has(sessionId))
      throw new CliError("An ACP prompt is already active for this session.", 6, "acp-error");
    const output = { text: "", bytes: 0 };
    this.promptText.set(sessionId, output);
    let result: unknown;
    try {
      result = await this.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: prompt }],
      });
    } finally {
      this.promptText.delete(sessionId);
    }
    if (!record(result))
      throw new CliError("ACP prompt returned an invalid response.", 6, "acp-error");
    const stopReason = String(result.stopReason ?? "end_turn");
    if (stopReason === "cancelled") {
      return { status: "cancelled", summary: stopReason };
    }
    if (stopReason === "refusal") {
      return { status: "blocked", summary: stopReason };
    }
    if (this.options.requireEndTurn && result.stopReason !== "end_turn")
      return { status: "blocked", summary: "incomplete-turn" };
    return {
      status: "completed",
      summary: output.text.trim() || String(result.summary ?? stopReason),
    };
  }

  cancel(sessionId: string): void {
    if (!this.child.stdin.destroyed) {
      this.child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } })}\n`,
      );
    }
  }

  async cancelAndStop(sessionId: string): Promise<void> {
    if (!this.child.stdin.destroyed) {
      await new Promise<void>((resolveWrite) => {
        const fallback = setTimeout(resolveWrite, 100);
        this.child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } })}\n`,
          () => {
            clearTimeout(fallback);
            resolveWrite();
          },
        );
      });
    }
    await this.stop();
  }

  close(): void {
    this.fail(new Error("ACP Agent client closed."));
    this.child.stdin.end();
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill();
  }

  async stop(): Promise<void> {
    await this.kill();
  }

  async kill(): Promise<void> {
    this.fail(new Error("ACP Agent client closed."));
    await killProcessTree(this.child);
    await this.closed;
    await Promise.allSettled([...this.updateWork, this.stderrPipeline]);
  }
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (platform() !== "win32") await chmod(path, 0o700);
  const handle = await open(path, "r");
  await handle.close();
}
