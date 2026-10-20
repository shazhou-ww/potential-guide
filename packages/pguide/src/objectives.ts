import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { hostname } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  atomicWrite,
  CliError,
  type GlobalOptions,
  loadConfig,
  option,
  type PguideConfig,
  parseConfig,
  readJsonSubject,
  rejectUnknownOptions,
  resolveObjective,
  userConfigPath,
  writeResult,
} from "@potential-guide/cli-core";
import {
  canonicalObjectiveUri,
  compileDomain,
  compileInputSchema,
  compileSubjectProjection,
  isJsonValue,
  type JsonObject,
  type JsonValue,
  type PilotSpec,
  parseStrictYaml,
  type Subject,
  validateSubject,
} from "@potential-guide/objective-pilot";

const execute = promisify(execFile);
export interface ObjectiveDeclaration {
  readonly description: string;
  readonly pilot: string;
  readonly inputSchema: JsonObject;
  readonly subject: string;
}
export interface ObjectiveEntry extends ObjectiveDeclaration {
  readonly name: string;
  readonly scope: "user" | "directory";
  readonly file: string;
  readonly revision: string;
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

export function parseObjectives(source: string): Record<string, ObjectiveDeclaration> {
  const value = parseStrictYaml(source);
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !object(value.objectives) ||
    Object.keys(value).some((key) => !["schemaVersion", "objectives"].includes(key))
  )
    throw new CliError("objectives.yaml requires schemaVersion: 1 and objectives only.");
  const entries: Record<string, ObjectiveDeclaration> = Object.create(null);
  for (const [name, entry] of Object.entries(value.objectives)) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
      !object(entry) ||
      Object.keys(entry).length !== 4 ||
      Object.keys(entry).some(
        (key) => !["description", "pilot", "inputSchema", "subject"].includes(key),
      ) ||
      !text(entry.description) ||
      !text(entry.pilot) ||
      !text(entry.subject) ||
      !object(entry.inputSchema) ||
      !isJsonValue(entry.inputSchema)
    )
      throw new CliError(
        `Invalid Objective ${name}: requires description, directory pilot, inputSchema and JSONata subject; target is not a declaration field.`,
      );
    compileInputSchema(entry.inputSchema);
    compileSubjectProjection(entry.subject);
    if (entry.pilot.startsWith("git+")) canonicalObjectiveUri(entry.pilot);
    else if (entry.pilot.replace(/\\/g, "/").replace(/\/$/, "").split("/").at(-1) === "pilot.yaml")
      throw new CliError(`Objective ${name} must reference a Pilot directory, not pilot.yaml.`);
    entries[name] = {
      description: entry.description,
      pilot: entry.pilot,
      inputSchema: entry.inputSchema,
      subject: entry.subject,
    };
  }
  return entries;
}
export function objectivesPath(scope: string, cwd: string): string {
  if (scope === "directory") return join(cwd, "objectives.yaml");
  if (scope === "user") return join(dirname(userConfigPath()), "objectives.yaml");
  throw new CliError("--scope must be user or directory.");
}
async function readEntries(
  file: string,
): Promise<{ entries: Record<string, ObjectiveDeclaration>; revision: string }> {
  try {
    const source = await readFile(file, "utf8");
    return {
      entries: parseObjectives(source),
      revision: createHash("sha256").update(source).digest("hex"),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: {}, revision: "" };
    throw error;
  }
}
export async function listObjectives(cwd: string, scope?: string): Promise<ObjectiveEntry[]> {
  const scopes = scope === undefined ? ["user", "directory"] : [scope];
  return (
    await Promise.all(
      scopes.map(async (selected) => {
        const file = objectivesPath(selected, cwd);
        const { entries, revision } = await readEntries(file);
        return Object.entries(entries).map(([name, entry]) => ({
          ...entry,
          name,
          scope: selected as ObjectiveEntry["scope"],
          file,
          revision,
        }));
      }),
    )
  ).flat();
}
type ContextGit = (args: readonly string[]) => Promise<string>;

function ordinaryExit(error: unknown, code: number): error is Record<string, unknown> {
  return (
    object(error) &&
    error.code === code &&
    error.killed !== true &&
    (error.signal === undefined || error.signal === null)
  );
}

function contextError(operation: string, cause: unknown): CliError {
  if (cause instanceof CliError) return cause;
  const code = object(cause) ? cause.code : undefined;
  const reason =
    code === "ENOENT"
      ? "Git executable or required repository metadata is unavailable"
      : code === "EACCES" || code === "EPERM"
        ? "access was denied"
        : code === "ETIMEDOUT" || (object(cause) && cause.killed === true)
          ? "Git timed out or was terminated"
          : "Git failed or returned invalid repository metadata";
  return new CliError(
    `Cannot build Objective context during ${operation}: ${reason}; no fallback identity was substituted.`,
    2,
    "context-error",
  );
}

async function verifyNonRepository(directory: string, filesystemBoundary: boolean): Promise<void> {
  const key = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);
  const ceilings = new Set(
    (process.env.GIT_CEILING_DIRECTORIES ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((path) => key(resolve(path))),
  );
  const metadata = async (path: string) => {
    try {
      return await lstat(path);
    } catch (error) {
      throw contextError("repository metadata inspection", error);
    }
  };
  const device = filesystemBoundary ? (await metadata(directory)).dev : undefined;
  let current = directory;
  for (;;) {
    try {
      await lstat(join(current, ".git"));
      throw new CliError(
        "Git rejected a directory with repository metadata; repair the checkout instead of treating it as a non-repository.",
        2,
        "context-error",
      );
    } catch (error) {
      if (!object(error) || error.code !== "ENOENT")
        throw contextError("repository metadata inspection", error);
    }
    const parent = dirname(current);
    if (parent === current || ceilings.has(key(parent))) return;
    if (filesystemBoundary && (await metadata(parent)).dev !== device) return;
    current = parent;
  }
}

export async function objectiveContext(cwd: string, executeGit?: ContextGit): Promise<JsonObject> {
  let directory: string;
  try {
    directory = await realpath(cwd);
  } catch (error) {
    throw contextError("directory resolution", error);
  }
  const run: ContextGit =
    executeGit ??
    (async (args) =>
      (
        await execute("git", ["--no-pager", "-C", directory, ...args], {
          windowsHide: true,
          timeout: 5_000,
          maxBuffer: 64 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", LANG: "C" },
        })
      ).stdout);
  const line = (source: string) => {
    if (typeof source !== "string") throw new Error("Invalid Git output.");
    const value = source.replace(/\r?\n$/, "");
    if (
      !value ||
      [...value].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new Error("Expected one nonempty Git output line.");
    return value;
  };
  const git = async (...args: string[]) => line(await run(args));
  let top: string;
  try {
    top = await run(["rev-parse", "--show-toplevel"]);
  } catch (error) {
    const filesystemBoundary =
      ordinaryExit(error, 128) &&
      typeof error.stderr === "string" &&
      /^fatal: not a git repository \(or any parent up to mount point [^\r\n]+\)\r?\nStopping at filesystem boundary \(GIT_DISCOVERY_ACROSS_FILESYSTEM not set\)\.\r?\n?$/.test(
        error.stderr,
      );
    const nonRepository =
      ordinaryExit(error, 128) &&
      error.stdout === "" &&
      typeof error.stderr === "string" &&
      (filesystemBoundary ||
        /^fatal: not a git repository \(or any of the parent directories\): \.git\r?\n?$/.test(
          error.stderr,
        ));
    if (!nonRepository) throw contextError("repository detection", error);
    await verifyNonRepository(directory, filesystemBoundary);
    return {
      repository: null,
      checkout: null,
      directory: { absolutePath: directory, relativePath: null },
    };
  }
  let root: string;
  let commonDirectory: string;
  try {
    const path = line(top);
    if (!isAbsolute(path)) throw new Error("Git checkout root must be absolute.");
    root = await realpath(path);
    commonDirectory = await realpath(
      resolve(directory, await git("rev-parse", "--git-common-dir")),
    );
    if (!(await lstat(commonDirectory)).isDirectory())
      throw new Error("Invalid common Git directory.");
  } catch (error) {
    throw contextError("checkout resolution", error);
  }
  const pathInRepository = relative(root, directory).split("\\").join("/");
  if (
    pathInRepository === ".." ||
    pathInRepository.startsWith("../") ||
    isAbsolute(pathInRepository)
  )
    throw contextError("directory resolution", new Error("Directory is outside checkout."));
  let configuredOrigin: string | undefined;
  try {
    configuredOrigin = await run(["config", "--local", "--get", "remote.origin.url"]);
  } catch (error) {
    if (!ordinaryExit(error, 1) || error.stdout !== "" || error.stderr !== "")
      throw contextError("origin configuration", error);
  }
  let repository = pathToFileURL(commonDirectory).href;
  if (configuredOrigin !== undefined) {
    let rawOrigin: string;
    try {
      line(configuredOrigin);
      rawOrigin = await git("remote", "get-url", "origin");
    } catch (error) {
      throw contextError("origin resolution", error);
    }
    try {
      const origin = new URL(rawOrigin);
      if (
        !["https:", "ssh:", "file:"].includes(origin.protocol) ||
        origin.username ||
        origin.password ||
        origin.search ||
        origin.hash
      )
        throw new Error("Unsupported or credential-bearing origin.");
      if (origin.protocol === "file:") fileURLToPath(origin);
      repository = origin.href;
    } catch {
      throw new CliError(
        "Repository origin must be an HTTPS, SSH or file URL without user info, query or fragment. SCP-like and other non-URL origins are unsupported; configure an explicit URL.",
        2,
        "context-error",
      );
    }
  }
  return {
    repository: { id: repository },
    checkout: {
      id: `urn:pguide:checkout:${createHash("sha256")
        .update(JSON.stringify([hostname(), commonDirectory, root]))
        .digest("hex")}`,
      rootPath: root,
    },
    directory: {
      absolutePath: directory,
      relativePath: pathInRepository || ".",
    },
  };
}
export function bindObjective(
  entry: ObjectiveDeclaration,
  context: JsonObject,
  input: JsonValue | undefined,
  spec: PilotSpec,
): Subject {
  const validate = compileInputSchema(entry.inputSchema);
  const schema = entry.inputSchema;
  const empty = (value: unknown) => object(value) && Object.keys(value).length === 0;
  const unit =
    empty(schema.const) ||
    (Array.isArray(schema.enum) && schema.enum.length === 1 && empty(schema.enum[0])) ||
    (schema.type === "object" &&
      (schema.maxProperties === 0 ||
        (schema.additionalProperties === false &&
          (schema.properties === undefined || empty(schema.properties)) &&
          (schema.patternProperties === undefined || empty(schema.patternProperties)))));
  const omittedIsValid = unit && validate({});
  if (input === undefined && !omittedIsValid)
    throw new CliError(
      "Objective input is required; provide --input-file. Only Unit input may be omitted.",
    );
  const value = input === undefined ? {} : input;
  if (!isJsonValue(value) || !validate(value))
    throw new CliError(`Invalid Objective input: ${JSON.stringify(validate.errors)}`);
  const subject = compileSubjectProjection(entry.subject, { requireDefined: true })({
    context,
    input: value,
  });
  if (!object(subject) || !isJsonValue(subject))
    throw new CliError("Objective projection must return a finite JSON object.");
  const issues = validateSubject(subject, compileDomain(spec.manifest.domainSchema));
  if (issues !== null) throw new CliError(`Invalid projected subject: ${JSON.stringify(issues)}`);
  return subject;
}
export async function selectObjective(
  argv: string[],
  globals: GlobalOptions,
  config: PguideConfig,
) {
  const name = option(argv, "--objective") as string | undefined;
  const pilot = option(argv, "--pilot") as string | undefined;
  const scope = option(argv, "--scope") as string | undefined;
  const inputFile = option(argv, "--input-file") as string | undefined;
  if (name === undefined) {
    if (scope !== undefined || inputFile !== undefined)
      throw new CliError("--scope and --input-file require --objective.");
    if (pilot === undefined)
      throw new CliError(
        "Select --objective <name> or --pilot <directory>; use pguide objectives list to discover entries.",
      );
    return {
      location: resolveObjective(pilot, config),
      binding: undefined,
      subject: async (spec: PilotSpec) =>
        (await readJsonSubject(
          option(argv, "--subject-file") as string | undefined,
          globals.cwd,
          spec.manifest.domainSchema,
        )) as Subject,
    };
  }
  if (pilot !== undefined || option(argv, "--subject-file") !== undefined)
    throw new CliError(
      "--objective is mutually exclusive with --pilot and --subject-file; use --input-file.",
    );
  const entries = (await listObjectives(globals.cwd, scope)).filter((entry) => entry.name === name);
  const entry = entries[0];
  if (entries.length !== 1 || entry === undefined)
    throw new CliError(
      entries.length === 0
        ? `Unknown Objective: ${name}.`
        : `Ambiguous Objective ${name}; select --scope user|directory.`,
    );
  const context = await objectiveContext(globals.cwd);
  let input: JsonValue | undefined;
  if (inputFile !== undefined) {
    const source =
      inputFile === "-"
        ? await (await import("@potential-guide/cli-core")).readStdin()
        : await readFile(resolve(globals.cwd, inputFile), "utf8");
    try {
      const parsed: unknown = JSON.parse(source);
      if (!isJsonValue(parsed)) throw new Error("Expected finite JSON.");
      input = parsed;
    } catch (cause) {
      throw new CliError(`Objective input must be finite JSON: ${String(cause)}`);
    }
  }
  return {
    location:
      entry.pilot.startsWith("git+") || isAbsolute(entry.pilot)
        ? entry.pilot
        : resolve(dirname(entry.file), entry.pilot),
    binding: { entry, context, input: input === undefined ? {} : input },
    subject: async (spec: PilotSpec) => bindObjective(entry, context, input, spec),
  };
}
export async function runObjectives(argv: string[], globals: GlobalOptions): Promise<void> {
  if (globals.help) {
    writeResult(
      { schemaVersion: 1, command: "objectives" },
      globals.format,
      "pguide objectives list|show <name> [--scope user|directory]\npguide objectives set|remove|migrate <name> --scope user|directory [--from <declaration.yaml>] [--legacy-config <config.yaml>]\nRead-only discovery never binds Pilots, evaluates subject or resolves remote versions. Writes require an explicit scope; --from contains one complete objectives.yaml entry with the selected name.",
    );
    return;
  }
  rejectUnknownOptions(
    argv,
    { "--scope": "value", "--from": "value", "--legacy-config": "value" },
    2,
  );
  const command = argv[0];
  const name = argv[1];
  const scope = option(argv, "--scope") as string | undefined;
  if (command === "list" || command === "show") {
    const entries = (await listObjectives(globals.cwd, scope)).filter(
      (entry) => command === "list" || entry.name === name,
    );
    if (command === "show" && entries.length !== 1)
      throw new CliError("show requires one unambiguous name; specify --scope.");
    const config = await loadConfig(globals.cwd, globals.config);
    const legacyAliases = Object.entries(config.value.objectives ?? {}).map(([alias, pilot]) => ({
      name: alias,
      pilot,
      semantics: "legacy-source-alias",
      file: config.sources[`objectives.${alias}`],
    }));
    writeResult(
      { schemaVersion: 1, objectives: entries, legacyAliases },
      globals.format,
      JSON.stringify({ objectives: entries, legacyAliases }, null, 2),
    );
    return;
  }
  if (!["set", "remove", "migrate"].includes(command ?? "") || !text(name) || scope === undefined)
    throw new CliError("Expected set|remove|migrate <name> --scope user|directory; see --help.");
  const file = objectivesPath(scope, globals.cwd);
  const { entries } = await readEntries(file);
  let legacy: { path: string; config: PguideConfig } | undefined;
  if (command === "remove") {
    if (!Object.hasOwn(entries, name)) throw new CliError(`Unknown Objective ${name}.`);
    delete entries[name];
  } else {
    const from = option(argv, "--from", { required: true }) as string;
    const candidate = parseObjectives(await readFile(resolve(globals.cwd, from), "utf8"));
    const selected = candidate[name];
    if (Object.keys(candidate).length !== 1 || selected === undefined)
      throw new CliError(
        "--from must declare exactly the selected Objective, with explicit inputSchema and subject.",
      );
    entries[name] = selected;
    if (command === "migrate") {
      if (Object.hasOwn((await readEntries(file)).entries, name))
        throw new CliError("Migration destination already exists.");
      const path = resolve(
        globals.cwd,
        option(argv, "--legacy-config", { required: true }) as string,
      );
      const config = parseConfig(await readFile(path, "utf8"));
      if (!config.objectives || !Object.hasOwn(config.objectives, name))
        throw new CliError("No matching legacy source alias in --legacy-config.");
      delete config.objectives[name];
      if (Object.keys(config.objectives).length === 0) delete config.objectives;
      legacy = { path, config };
    }
  }
  const source = `${JSON.stringify({ schemaVersion: 1, objectives: entries }, null, 2)}\n`;
  parseObjectives(source);
  await atomicWrite(file, source);
  if (legacy !== undefined)
    await atomicWrite(legacy.path, `${JSON.stringify(legacy.config, null, 2)}\n`);
  writeResult(
    { schemaVersion: 1, status: command, file, name },
    globals.format,
    `${command}: ${name} (${file})`,
  );
}
