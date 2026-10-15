import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parse, stringify } from "yaml";

export const COMMAND_PROTOCOL = "pguide-command-v1";

export interface CommandMetadata {
  protocol: typeof COMMAND_PROTOCOL;
  command: string;
  description: string;
  version: string;
}

export interface AgentProfile {
  connection: { type: "acp"; protocolVersion: string };
  transport: { type: "stdio"; command: string; args?: string[]; env?: string[] };
  requirements?: { sessionResume?: boolean };
}

export interface PguideConfig {
  schemaVersion: 1;
  defaultAgent?: string;
  commandDirectories?: string[];
  defaultLanguage?: string;
  format?: "markdown" | "json";
  color?: "auto" | "always" | "never";
  logLevel?: "error" | "warn" | "info" | "debug";
  stateDirectory?: string;
  retentionDays?: number;
  limits?: { maxIterations?: number; maxStalledIterations?: number; timeoutMs?: number };
  agents?: Record<string, AgentProfile>;
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

export function validateAgentProfile(value: unknown): AgentProfile {
  if (!record(value)) throw new CliError("Agent profile must be an object.");
  exactKeys(value, ["connection", "transport", "requirements"], "Agent profile");
  if (!record(value.connection)) throw new CliError("Agent connection is required.");
  exactKeys(value.connection, ["type", "protocolVersion"], "Agent connection");
  if (value.connection.type !== "acp" || !nonempty(value.connection.protocolVersion)) {
    throw new CliError("Agent connection must select ACP and a protocolVersion.");
  }
  if (!record(value.transport)) throw new CliError("Agent stdio transport is required.");
  exactKeys(value.transport, ["type", "command", "args", "env"], "Agent transport");
  if (value.transport.type !== "stdio" || !nonempty(value.transport.command)) {
    throw new CliError("Agent transport must be stdio with a command.");
  }
  if (
    value.transport.args !== undefined &&
    (!Array.isArray(value.transport.args) || !value.transport.args.every(nonempty))
  ) {
    throw new CliError("Agent transport args must be nonempty strings.");
  }
  if (
    value.transport.env !== undefined &&
    (!Array.isArray(value.transport.env) ||
      !value.transport.env.every((entry) => nonempty(entry) && /^[A-Z_][A-Z0-9_]*$/.test(entry)))
  ) {
    throw new CliError("Agent transport env must contain environment variable names.");
  }
  if (value.requirements !== undefined) {
    if (!record(value.requirements)) throw new CliError("Agent requirements must be an object.");
    exactKeys(value.requirements, ["sessionResume"], "Agent requirements");
    if (
      value.requirements.sessionResume !== undefined &&
      typeof value.requirements.sessionResume !== "boolean"
    ) {
      throw new CliError("sessionResume must be boolean.");
    }
  }
  const source = stringify(value);
  if (/(token|password|api[-_]?key|secret)\s*:\s*(?!null\b|["']?env\b)\S+/i.test(source)) {
    throw new CliError("Agent profiles may not contain credential literals.");
  }
  return value as unknown as AgentProfile;
}

export function parseConfig(source: string): PguideConfig {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    throw new CliError(`Invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!record(raw)) throw new CliError("Configuration must be an object.");
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
      "limits",
      "agents",
    ],
    "Configuration",
  );
  if (raw.schemaVersion !== 1) throw new CliError("Configuration schemaVersion must be 1.");
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
  if (raw.limits !== undefined) {
    if (!record(raw.limits)) throw new CliError("limits must be an object.");
    exactKeys(raw.limits, ["maxIterations", "maxStalledIterations", "timeoutMs"], "limits");
    positiveInteger(raw.limits.maxIterations, "limits.maxIterations");
    positiveInteger(raw.limits.maxStalledIterations, "limits.maxStalledIterations");
    positiveInteger(raw.limits.timeoutMs, "limits.timeoutMs");
  }
  if (raw.agents !== undefined) {
    if (!record(raw.agents)) throw new CliError("agents must be an object.");
    for (const [name, profile] of Object.entries(raw.agents)) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new CliError(`Invalid agent name: ${name}.`);
      validateAgentProfile(profile);
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
  if (incoming.limits !== undefined) next.limits = { ...target.limits, ...incoming.limits };
  if (incoming.agents !== undefined) next.agents = { ...target.agents, ...incoming.agents };
  for (const key of Object.keys(incoming)) sources[key] = source;
  for (const name of Object.keys(incoming.agents ?? {})) sources[`agents.${name}`] = source;
  return next;
}

export async function loadConfig(cwd: string, explicit?: string): Promise<LoadedConfig> {
  const user = userConfigPath();
  const project = await existingProjectConfig(cwd);
  let value: PguideConfig = { schemaVersion: 1 };
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
    value: parseConfig(stringify({ ...value, schemaVersion: 1 })),
    sources,
    paths: {
      user,
      ...(project === undefined ? {} : { project }),
      ...(explicit ? { explicit } : {}),
    },
  };
}

export function redactConfig(config: PguideConfig): PguideConfig {
  return JSON.parse(JSON.stringify(config)) as PguideConfig;
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

export async function readJsonSubject(path: string, cwd: string): Promise<Record<string, unknown>> {
  const source = path === "-" ? await readStdin() : await readFile(resolve(cwd, path), "utf8");
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

export function writeResult(
  value: Record<string, unknown>,
  format: "markdown" | "json",
  markdown: string,
): void {
  process.stdout.write(format === "json" ? `${JSON.stringify(value, null, 2)}\n` : `${markdown}\n`);
}

export async function commandMain(
  metadata: CommandMetadata,
  run: (argv: string[], globals: GlobalOptions) => Promise<number | void>,
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
    const failure =
      error instanceof CliError
        ? error
        : new CliError(
            error instanceof Error ? error.message : String(error),
            70,
            "internal-error",
          );
    const format =
      process.argv.includes("--format") &&
      process.argv[process.argv.indexOf("--format") + 1] === "json"
        ? "json"
        : "markdown";
    writeResult(
      { schemaVersion: 1, status: failure.status, error: failure.message },
      format,
      `Error: ${failure.message}`,
    );
    process.exitCode = failure.exitCode;
  }
}

interface RpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
}

export interface AcpUpdate {
  timestamp: string;
  method: string;
  params: unknown;
}

export class AcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private nextId = 1;
  readonly updates: AcpUpdate[] = [];

  constructor(
    profile: AgentProfile,
    private readonly onUpdate: (update: AcpUpdate) => Promise<void> = async () => undefined,
  ) {
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
    this.child.stderr.pipe(process.stderr);
    this.child.on("error", (error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    this.child.on("close", (code) => {
      if (this.pending.size === 0) return;
      const error = new Error(`ACP Agent exited before replying (${String(code)}).`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => void this.receive(line));
  }

  private async receive(line: string): Promise<void> {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending !== undefined) {
        this.pending.delete(message.id);
        if (message.error !== undefined)
          pending.reject(new Error(message.error.message ?? "ACP error"));
        else pending.resolve(message.result);
      }
      return;
    }
    if (message.method !== undefined) {
      const update = {
        timestamp: new Date().toISOString(),
        method: message.method,
        params: message.params,
      };
      this.updates.push(update);
      await this.onUpdate(update);
    }
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async initialize(protocolVersion: string): Promise<Record<string, unknown>> {
    const result = await this.request("initialize", {
      protocolVersion,
      clientInfo: { name: "pguide", version: "0.1.0" },
      clientCapabilities: {},
    });
    if (!record(result))
      throw new CliError("ACP initialize returned an invalid response.", 6, "acp-error");
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
    await this.request("session/resume", { sessionId, cwd, mcpServers: [] });
  }

  async prompt(
    sessionId: string,
    prompt: string,
  ): Promise<{ status: "completed" | "blocked"; summary: string }> {
    const result = await this.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: prompt }],
    });
    if (!record(result))
      throw new CliError("ACP prompt returned an invalid response.", 6, "acp-error");
    const stopReason = String(result.stopReason ?? "end_turn");
    if (stopReason === "refusal" || stopReason === "cancelled") {
      return { status: "blocked", summary: stopReason };
    }
    return { status: "completed", summary: String(result.summary ?? stopReason) };
  }

  cancel(sessionId: string): void {
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } })}\n`,
    );
  }

  close(): void {
    this.child.stdin.end();
  }
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (platform() !== "win32") await chmod(path, 0o700);
  const handle = await open(path, "r");
  await handle.close();
}
