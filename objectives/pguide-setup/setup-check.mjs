#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outputLimit = 262_144;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.trim() !== "";

class Fault extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
class Problem extends Error {
  constructor(id, parameters = {}) {
    super(id);
    this.id = id;
    this.parameters = parameters;
  }
}
const success = () => ({ status: 200, payload: { ok: true, problems: [] }, message: "" });
const problem = (id, parameters = {}) => ({
  status: 200,
  payload: { ok: false, problems: [{ id, parameters }] },
  message: "",
});

function subjectValue(value, selfCheck = false) {
  const required = ["workingDirectory", "configPath", "scratchDirectory", "pguide"];
  const optional = ["desiredVersion", "agent", "userHome", "allowSanity", "timeoutMs", "target"];
  const remote = value?.target?.type === "ssh";
  if (selfCheck && (value?.target !== undefined || value?.allowSanity !== undefined))
    throw new Fault("invalid-subject: self-check is local-only and has no allowSanity input.", 400);
  const absolute = remote ? posix.isAbsolute : isAbsolute;
  if (
    !record(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key)) ||
    required.slice(0, 3).some((key) => !nonempty(value[key]) || !absolute(value[key])) ||
    !record(value.pguide) ||
    Object.keys(value.pguide).some((key) => !["command", "args"].includes(key)) ||
    !nonempty(value.pguide.command) ||
    (value.pguide.args !== undefined &&
      (!Array.isArray(value.pguide.args) || !value.pguide.args.every(nonempty))) ||
    ["desiredVersion", "agent"].some((key) => value[key] !== undefined && !nonempty(value[key])) ||
    (value.userHome !== undefined && (!nonempty(value.userHome) || !isAbsolute(value.userHome))) ||
    (remote && value.userHome !== undefined) ||
    (value.target !== undefined &&
      (!record(value.target) ||
        (!remote && (value.target.type !== "local" || Object.keys(value.target).length !== 1)))) ||
    (value.allowSanity !== undefined && typeof value.allowSanity !== "boolean") ||
    (value.timeoutMs !== undefined &&
      (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 100 || value.timeoutMs > 300000))
  )
    throw new Fault("invalid-subject: see the setup subject contract.", 400);
  return { ...value, timeoutMs: value.timeoutMs ?? 20000 };
}

function launch(command, args, options) {
  if (
    process.platform === "win32" &&
    !/[\\/:]/.test(command) &&
    !/\.(exe|com|cmd|bat)$/i.test(command)
  ) {
    const directories = (options.env.PATH ?? options.env.Path ?? "")
      .split(delimiter)
      .filter(Boolean);
    const candidates = directories.flatMap((directory) =>
      [".exe", ".com", ".cmd", ".bat"].map((extension) => join(directory, command + extension)),
    );
    command = candidates.find((candidate) => existsSync(candidate)) ?? command;
  }
  // Native Node cannot spawn Windows npm .cmd shims. Never interpolate shell metacharacters.
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    if ([command, ...args].some((part) => /[%!&|<>^"\r\n]/.test(part)))
      throw new Fault("unsupported-command: use node with the absolute CLI .js entrypoint.");
    return spawn(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", `"${[command, ...args].map((part) => `"${part}"`).join(" ")}"`],
      { ...options, windowsVerbatimArguments: true },
    );
  }
  return spawn(command, args, options);
}

async function descendants(pid) {
  return new Promise((done, reject) => {
    const listing = spawn("ps", ["-eo", "pid=,ppid="], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    let failure;
    const timeout = setTimeout(() => {
      failure = new Fault("cleanup: process tree enumeration timed out.", 504);
      listing.kill("SIGKILL");
    }, 1000);
    listing.stdout.on("data", (chunk) => {
      if (failure !== undefined) return;
      output += chunk;
      if (Buffer.byteLength(output) > 4_194_304) {
        failure = new Fault("cleanup: process tree enumeration output exceeded its bound.");
        listing.kill("SIGKILL");
      }
    });
    listing.once("error", () => {
      failure = new Fault("cleanup: ps is required to terminate detached descendants.");
    });
    listing.once("close", (code) => {
      clearTimeout(timeout);
      if (failure !== undefined || code !== 0) {
        reject(failure ?? new Fault("cleanup: process tree enumeration failed."));
        return;
      }
      const rows = output
        .trim()
        .split("\n")
        .map((line) => line.trim().split(/\s+/).map(Number));
      const found = new Set([pid]);
      let added = true;
      while (added) {
        added = false;
        for (const [childPid, parentPid] of rows) {
          if (found.has(parentPid) && !found.has(childPid)) {
            found.add(childPid);
            added = true;
          }
        }
      }
      done([...found].reverse());
    });
  });
}

export async function stopTree(child) {
  if (child.pid === undefined) return;
  if (process.platform !== "win32") {
    // Regulate and ACP may create separate process groups. Capture descendants before killing parents.
    const pids = await descendants(child.pid);
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw new Fault("cleanup: descendant termination failed.");
      }
    }
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw new Fault("cleanup: process group termination failed.");
    }
    return;
  }
  await new Promise((done, reject) => {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    const timeout = setTimeout(() => {
      killer.kill();
      reject(new Fault("cleanup: process tree termination timed out.", 504));
    }, 1500);
    killer.once("error", () => {
      clearTimeout(timeout);
      reject(new Fault("cleanup: taskkill unavailable."));
    });
    killer.once("close", () => {
      clearTimeout(timeout);
      done();
    });
  });
}

function executionContext(subject, directory, signal, deadline) {
  const env = { ...process.env };
  // A caller's Git index/worktree/config overrides must not escape the owned fixture.
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = join(directory, "empty-git-config");
  env.PATH = process.env.PATH ?? process.env.Path;
  if (process.platform === "win32") {
    env.SystemRoot = process.env.SystemRoot;
    env.ComSpec = process.env.ComSpec;
  }
  if (subject.userHome !== undefined) {
    env.HOME = subject.userHome;
    env.USERPROFILE = subject.userHome;
  }
  // Runtime state overrides must never redirect the bounded run into the real user's state.
  env.PGUIDE_STATE_DIRECTORY = join(directory, "state");
  delete env.PGUIDE_FORMAT;
  delete env.PGUIDE_LANGUAGE;
  async function execute(command, args, settings = {}) {
    signal.throwIfAborted();
    return new Promise((done, reject) => {
      let child;
      try {
        child = launch(command, args, {
          cwd: settings.cwd ?? directory,
          env: settings.env ?? env,
          detached: process.platform !== "win32",
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        reject(error);
        return;
      }
      let stdout = "";
      let bytes = 0;
      let failure;
      let stopping;
      const stop = (error) => {
        failure ??= error;
        stopping ??= stopTree(child).catch((cleanupError) => {
          child.kill("SIGKILL");
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
          throw cleanupError;
        });
        void stopping.catch(() => {});
      };
      const abort = () => stop(new Fault("timeout: setup check exceeded its deadline.", 504));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      child.on("error", (error) => {
        failure =
          error.code === "ENOENT"
            ? new Problem(settings.missing ?? "installation-missing")
            : new Fault("process-start: executable could not be started.");
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (stopping !== undefined) return;
        bytes += Buffer.byteLength(chunk);
        if (bytes > outputLimit) {
          stop(new Fault("output-limit: child output exceeded 256 KiB."));
          return;
        }
        stdout += chunk;
        if (settings.onLine !== undefined) settings.onLine(chunk, child, stop);
      });
      child.stderr.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > outputLimit) stop(new Fault("output-limit: child output exceeded 256 KiB."));
      });
      child.stdin.on("error", () => stop(new Fault("process-stdin: child closed its input.")));
      child.once("close", async (code) => {
        signal.removeEventListener("abort", abort);
        try {
          if (stopping !== undefined) await stopping;
          else if (process.platform !== "win32") await stopTree(child);
          if (failure !== undefined) reject(failure);
          else done({ code, stdout });
        } catch (error) {
          reject(error);
        }
      });
      if (settings.begin !== undefined) settings.begin(child);
      else child.stdin.end();
    });
  }
  const cli = (args, config = subject.configPath, cwd = directory) =>
    execute(subject.pguide.command, [
      ...(subject.pguide.args ?? []),
      ...args,
      "--config",
      config,
      "--cwd",
      cwd,
      "--format",
      "json",
    ]);
  return { execute, cli, env, remainingMs: () => deadline - Date.now() };
}

function jsonOutput(result) {
  try {
    const value = JSON.parse(result.stdout);
    if (!record(value)) throw new Error();
    return value;
  } catch {
    throw new Fault("protocol: CLI output was not a JSON object.");
  }
}

async function installation(subject, context) {
  const result = await context.execute(subject.pguide.command, [
    ...(subject.pguide.args ?? []),
    "--version",
    "--format",
    "json",
  ]);
  if (result.code !== 0) throw new Problem("installation-unusable");
  const value = jsonOutput(result);
  if (value.schemaVersion !== 1 || value.name !== "pguide" || !nonempty(value.version))
    throw new Fault("protocol: unsupported pguide version response.");
  if (subject.desiredVersion !== undefined && value.version !== subject.desiredVersion)
    throw new Problem("version-mismatch");
}

async function configured(subject, context) {
  await installation(subject, context);
  try {
    if (!(await lstat(subject.configPath)).isFile()) throw new Problem("configuration-invalid");
  } catch (error) {
    if (error.code === "ENOENT") throw new Problem("configuration-missing");
    throw error;
  }
  const help = await context.cli(["--help"], subject.configPath, subject.workingDirectory);
  if (help.code !== 0) throw new Problem("configuration-invalid");
  const capabilities = jsonOutput(help);
  if (!Array.isArray(capabilities.commands) || !record(capabilities.conflicts))
    throw new Fault("protocol: unsupported command discovery response.");
  for (const name of ["config", "probe", "regulate"])
    if (
      capabilities.conflicts[name] !== undefined ||
      !capabilities.commands.some(
        (entry) =>
          entry.command === name &&
          entry.compatible === true &&
          entry.protocol === "pguide-command-v1",
      )
    )
      throw new Problem("command-unavailable");
  const result = await context.cli(
    ["config", "show"],
    subject.configPath,
    subject.workingDirectory,
  );
  if (result.code !== 0) throw new Problem("configuration-invalid");
  const value = jsonOutput(result);
  if (value.schemaVersion !== 1 || !record(value.config) || value.config.schemaVersion !== 2)
    throw new Fault("protocol: unsupported configuration response.");
  const config = value.config;
  const name = subject.agent ?? config.defaultAgent;
  if (!nonempty(name) || !record(config.agents?.[name])) throw new Problem("agent-missing");
  const profile = config.agents[name];
  if (profile.type === "ahp")
    throw new Problem("acp-unavailable", {
      reason:
        "This setup Pilot verifies ACP stdio readiness only. Select an ACP profile; AHP runtime support does not imply ACP compatibility.",
    });
  if (
    !(
      (profile.type === "acp" && profile.connection?.type === undefined) ||
      (profile.type === undefined && profile.connection?.type === "acp")
    ) ||
    !/^[1-9][0-9]*$/.test(profile.connection.protocolVersion) ||
    typeof profile.connection.protocolVersion !== "string" ||
    !Number.isSafeInteger(Number(profile.connection.protocolVersion)) ||
    profile.transport?.type !== "stdio" ||
    !nonempty(profile.transport.command) ||
    (profile.transport.args !== undefined &&
      (!Array.isArray(profile.transport.args) || !profile.transport.args.every(nonempty))) ||
    (profile.transport.env !== undefined &&
      (!Array.isArray(profile.transport.env) ||
        !profile.transport.env.every((key) => /^[A-Z_][A-Z0-9_]*$/.test(key))))
  )
    throw new Fault("protocol: invalid Agent profile returned by config.");
  if ((profile.transport.env ?? []).some((key) => !nonempty(context.env[key])))
    throw new Problem("environment-unavailable");
  return { config, name, profile };
}

async function acpReady(profile, context, directory) {
  const allowed = [
    "PATH",
    ...(process.platform === "win32" ? ["SystemRoot", "ComSpec"] : []),
    ...(profile.transport.env ?? []),
  ];
  const env = Object.fromEntries(
    allowed.flatMap((key) => (context.env[key] === undefined ? [] : [[key, context.env[key]]])),
  );
  let buffer = "";
  let phase = 1;
  let ready = false;
  const send = (child, id, method, params) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  const result = await context.execute(profile.transport.command, profile.transport.args ?? [], {
    env,
    missing: "acp-unavailable",
    begin: (child) =>
      send(child, 1, "initialize", {
        protocolVersion: Number(profile.connection.protocolVersion),
        clientInfo: { name: "pguide-setup", version: "1" },
        clientCapabilities: {},
      }),
    onLine(chunk, child, stop) {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          stop(new Fault("protocol: malformed ACP JSON."));
          return;
        }
        if (!record(message) || message.jsonrpc !== "2.0") {
          stop(new Fault("protocol: invalid ACP response."));
          return;
        }
        if (message.id === undefined && nonempty(message.method)) continue;
        if (message.id !== phase || message.method !== undefined) {
          stop(new Fault("protocol: unexpected ACP response."));
          return;
        }
        if (message.error !== undefined) {
          stop(
            new Problem("acp-unavailable", {
              stage: phase === 1 ? "initialize" : "session-new",
              reason: "agent-rejected",
            }),
          );
          return;
        }
        if (!record(message.result)) {
          stop(new Fault("protocol: ACP result must be an object."));
          return;
        }
        if (phase === 1) {
          if (
            message.result.protocolVersion !== Number(profile.connection.protocolVersion) ||
            (profile.requirements?.sessionResume === true &&
              message.result.agentCapabilities?.loadSession !== true)
          ) {
            stop(
              new Problem("acp-unavailable", {
                stage: "initialize",
                reason: "incompatible-capabilities",
              }),
            );
            return;
          }
          phase = 2;
          send(child, 2, "session/new", { cwd: directory, mcpServers: [] });
        } else {
          if (!nonempty(message.result.sessionId)) {
            stop(new Fault("protocol: ACP session/new returned no sessionId."));
            return;
          }
          ready = true;
          child.stdin.end();
          // Readiness is complete; terminate even Agents that do not exit on EOF.
          stop(undefined);
        }
      }
    },
  });
  if (!ready || (result.code !== 0 && phase !== 2))
    throw new Problem("acp-unavailable", {
      stage: phase === 1 ? "initialize" : "session-new",
      reason: "agent-exited",
    });
}

async function sanity(subject, context, directory, selected) {
  const repository = join(directory, "fixture");
  await cp(join(here, "sanity-fixture"), repository, { recursive: true });
  const marker = join(repository, "marker.txt");
  const expected = randomBytes(24).toString("hex");
  await writeFile(marker, "not-repaired");
  const subjectFile = join(directory, "sanity-subject.json");
  await writeFile(subjectFile, JSON.stringify({ marker, expected }));
  const configPath = join(directory, "sanity-config.json");
  // The outer deadline already bounds preparation, execution and cleanup. A fixed
  // reserve could exhaust regulation during module startup, before any ACP prompt.
  const timeoutMs = subject.timeoutMs;
  const config = {
    schemaVersion: 2,
    commandDirectories: (selected.config.commandDirectories ?? []).map((path) =>
      resolve(subject.workingDirectory, path),
    ),
    defaultAgent: selected.name,
    agents: { [selected.name]: selected.profile },
    stateDirectory: join(directory, "state"),
    agentExecutionLimits: { timeoutMs },
    regulationStrategy: {
      quota: { timeoutMs, maxAgentRuns: 1, maxStallRuns: 1 },
      probe: { timeoutMs: 3000, retry: { maxRetries: 0, delayMs: 0 } },
    },
  };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const git = async (...args) => {
    const result = await context.execute("git", ["-C", repository, ...args], {
      missing: "git-unavailable",
    });
    if (result.code !== 0) throw new Fault("git: isolated fixture preparation failed.");
    return result.stdout.trim();
  };
  await git("init", "-q");
  await git("config", "user.name", "pguide setup");
  await git("config", "user.email", "setup@example.invalid");
  await git("add", ".");
  await git("-c", "commit.gpgsign=false", "commit", "-qm", "Bounded setup fixture");
  const revision = await git("rev-parse", "HEAD");
  const uri = `git+${pathToFileURL(repository).href}#pilot.yaml`;
  const common = ["--pilot", uri, "--revision", revision, "--subject-file", subjectFile];
  const probe = async () => {
    const result = await context.cli(["probe", ...common], configPath, repository);
    const report = jsonOutput(result);
    if (result.code !== 0 || report.status !== 200 || !record(report.payload))
      throw new Fault("protocol: independent sanity probe failed.");
    return report.payload;
  };
  const initial = await probe();
  if (
    initial.current?.levelId !== "unrepaired" ||
    !initial.problems?.some((entry) => entry.ref?.problemId === "marker-incorrect")
  )
    throw new Fault("sanity: initial failure was not independently observed.");
  const result = await context.cli(
    ["regulate", ...common, "--target", "terminal", "--agent", selected.name],
    configPath,
    repository,
  );
  const report = jsonOutput(result);
  if (result.code !== 0) {
    if (result.code !== 5 || report.outcome?.stopReason !== "exhausted") {
      // Only fixed diagnostic labels cross this boundary, never Agent/config/auth error text.
      const status = ["acp-error", "regulation-error", "io-error", "internal-error"].includes(
        report.status,
      )
        ? report.status
        : "unrecognized";
      const snapshotDiagnostic =
        typeof report.error === "string"
          ? /windows-snapshot-command\[kind=(?:timeout|exit|spawn|signal|output-limit|unknown);exit=(?:-?\d{1,10}|none);errno=(?:ENOENT|EACCES|EPERM|EINVAL|E2BIG|ENOMEM|ETIMEDOUT|UNKNOWN|ERR_CHILD_PROCESS_STDIO_MAXBUFFER|none);signal=(?:SIGTERM|SIGKILL|none);killed=(?:true|false);elapsedMs=\d{1,10};reported=(?:true|false);nativeCode=(?:\d{1,10}|none);phase=(?:unreported|started|importing|imported|compiling|compiled|query-started|queried|serialized|exiting);reason=(?:command-not-found|module-autoload|module-not-found|module-load|module-manifest|access-denied|native-snapshot|native-first|native-next|native-close|unclassified)\]/.exec(
              report.error,
            )?.[0]
          : undefined;
      const diagnostic =
        snapshotDiagnostic ??
        [
          ["PguideWindowsProcessSnapshot", "windows-snapshot-command"],
          ["Invalid Windows process tree snapshot.", "windows-snapshot-format"],
          ["Process tree termination and ownership snapshot failed.", "windows-tree-and-snapshot"],
          ["Could not verify process tree cleanup.", "windows-tree-unobservable"],
          ["Check timed out after 3000ms.", "inner-probe-deadline"],
        ].find(
          ([message]) => typeof report.error === "string" && report.error.includes(message),
        )?.[1] ??
        "unclassified";
      throw new Fault(
        `regulate: Agent or probe invocation failed (exit=${result.code ?? "signal"}, status=${status}, diagnostic=${diagnostic}).`,
      );
    }
    if (["time", "agent-limit"].includes(report.outcome.exhaustedBy))
      throw new Fault("timeout: sanity regulation exhausted its time allowance.", 504);
    if (!["agent-runs", "stall"].includes(report.outcome.exhaustedBy))
      throw new Fault("protocol: unknown sanity exhaustion reason.");
    throw new Problem("sanity-failed", {
      stage: "regulate",
      reason: "quota-exhausted",
      exhaustedBy: report.outcome.exhaustedBy,
    });
  }
  if (report.outcome?.stopReason !== "target-reached" || report.outcome?.iterations !== 1)
    throw new Fault("protocol: unexpected sanity regulation outcome.");
  const final = await probe();
  let correct = false;
  try {
    const details = await lstat(marker);
    correct =
      details.isFile() &&
      details.size === expected.length &&
      (await readFile(marker, "utf8")) === expected;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!correct || final.current?.levelId !== "terminal" || final.problems?.length !== 0)
    throw new Problem("sanity-failed", {
      stage: "recheck",
      reason: !correct ? "nonce-mismatch" : "target-not-reached",
    });
}

async function directSanity(context, directory, selected) {
  const task = join(directory, "task");
  await mkdir(task, { mode: 0o700 });
  const marker = join(task, "marker.txt");
  const expected = `ready-${randomBytes(24).toString("hex")}`;
  await writeFile(marker, "not-ready", { mode: 0o600 });
  if ((await readFile(marker, "utf8")) === expected)
    throw new Fault("sanity: initial marker was not independently observed.");
  const input = join(directory, "agent-input.json");
  await writeFile(
    input,
    JSON.stringify({
      cwd: task,
      expected,
      profile: selected.profile,
      permissions: selected.config.regulationPermissions,
      timeoutMs: Math.max(
        1,
        Math.min(
          context.remainingMs() - 2500,
          selected.config.agentExecutionLimits?.timeoutMs ?? Number.POSITIVE_INFINITY,
        ),
      ),
    }),
    { mode: 0o600 },
  );
  const result = await context.execute(process.execPath, [join(here, "direct-agent.mjs"), input]);
  if (result.code !== 0) throw new Fault("sanity: direct Agent process failed.");
  const outcome = jsonOutput(result);
  if (outcome.reason === "timeout")
    throw new Fault("timeout: direct Agent exceeded its deadline.", 504);
  if (outcome.status !== "completed")
    throw new Problem("sanity-failed", {
      stage: "agent",
      reason: ["denied", "blocked", "cancelled", "output-limit", "invocation-failed"].includes(
        outcome.reason,
      )
        ? outcome.reason
        : "invalid-outcome",
    });
  let correct = false;
  try {
    const details = await lstat(marker);
    correct =
      details.isFile() &&
      !details.isSymbolicLink() &&
      details.nlink === 1 &&
      details.size === Buffer.byteLength(expected) &&
      (await readFile(marker, "utf8")) === expected;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!correct) throw new Problem("sanity-failed", { stage: "recheck", reason: "nonce-mismatch" });
}

export async function check(stage, value, options = {}) {
  let directory;
  let timer;
  let abort;
  try {
    if (!["installation", "configuration", "sanity"].includes(stage))
      throw new Fault("usage: select installation, configuration, or sanity.", 400);
    const subject = subjectValue(value, options.selfCheck === true);
    const remote = subject.target?.type === "ssh";
    if (remote) {
      const { validateTarget } = await import("./ssh-target.mjs");
      validateTarget(subject.target);
    }
    // Legacy setup retains its separate sanity consent gate.
    if (stage === "sanity" && !options.selfCheck && subject.allowSanity !== true)
      return problem("sanity-consent-required");
    if (options.pilot === true) {
      if (remote || options.selfCheck) {
        if (subject.timeoutMs + (remote ? 10000 : 0) > 24000)
          throw new Fault(
            "outer-timeout: SSH and self-check Pilot checks require a total budget <=24000ms.",
            400,
          );
      } else {
        const metadata = process.env.PGUIDE_PROBE_TIMEOUT_MS;
        const outerTimeoutMs = metadata === undefined ? 30000 : Number(metadata);
        if (
          (metadata !== undefined && metadata !== String(outerTimeoutMs)) ||
          !Number.isSafeInteger(outerTimeoutMs) ||
          outerTimeoutMs < 1 ||
          outerTimeoutMs > 2147483647
        )
          throw new Fault("outer-timeout: invalid PGUIDE_PROBE_TIMEOUT_MS runtime metadata.", 400);
        // The outer process also owns startup, response emission and tree/scratch cleanup.
        if (subject.timeoutMs + 6000 > outerTimeoutMs)
          throw new Fault(
            "outer-timeout: local Pilot process budget must cover timeoutMs plus 6000ms startup/cleanup reserve.",
            400,
          );
      }
    }
    if (remote) {
      const { checkSsh } = await import("./ssh-target.mjs");
      return await checkSsh(stage, subject);
    }
    const controller = new AbortController();
    abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    timer = setTimeout(
      () => controller.abort(new Fault("timeout: setup check exceeded its deadline.", 504)),
      subject.timeoutMs,
    );
    await mkdir(subject.scratchDirectory, { recursive: true });
    const probeDirectory =
      options.pilot && !options.selfCheck ? process.env.PGUIDE_PROBE_TEMP_DIR : undefined;
    if (probeDirectory !== undefined && !isAbsolute(probeDirectory))
      throw new Fault("outer-timeout: invalid PGUIDE_PROBE_TEMP_DIR runtime metadata.", 400);
    // Nested Git caches also create directories; keep Windows path headroom inside the probe.
    directory = await mkdtemp(
      join(
        probeDirectory ?? subject.scratchDirectory,
        probeDirectory === undefined ? "pguide-setup-" : "s-",
      ),
    );
    const context = executionContext(
      subject,
      directory,
      controller.signal,
      Date.now() + subject.timeoutMs,
    );
    if (stage === "installation") await installation(subject, context);
    else {
      const selected = await configured(subject, context);
      await acpReady(selected.profile, context, directory);
      if (stage === "sanity") {
        if (options.selfCheck) await directSanity(context, directory, selected);
        else await sanity(subject, context, directory, selected);
      }
    }
    return success();
  } catch (error) {
    if (error instanceof Problem) return problem(error.id, error.parameters);
    if (error.name === "TargetFault")
      return { status: error.status, payload: null, message: error.message };
    return {
      status: error instanceof Fault ? error.status : 502,
      payload: null,
      message:
        error instanceof Fault
          ? error.message
          : "io: setup check failed; inspect paths and permissions.",
    };
  } finally {
    clearTimeout(timer);
    if (abort) options.signal?.removeEventListener("abort", abort);
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}

export async function main(stage = process.argv[2], options = {}) {
  try {
    const args = process.argv.slice(3);
    let source;
    if (args.length === 2 && args[0] === "--subject-file" && isAbsolute(args[1])) {
      const details = await lstat(args[1]);
      if (details.size > outputLimit)
        throw new Fault("input-limit: subject exceeded 256 KiB.", 400);
      source = await readFile(args[1], "utf8");
    } else if (args.length === 0) {
      source = "";
      const inputTimeout = setTimeout(
        () => process.stdin.destroy(new Fault("input-timeout: subject was not received.", 408)),
        5000,
      );
      try {
        for await (const chunk of process.stdin) {
          source += chunk;
          if (Buffer.byteLength(source) > outputLimit)
            throw new Fault("input-limit: subject exceeded 256 KiB.", 400);
        }
      } finally {
        clearTimeout(inputTimeout);
      }
    } else throw new Fault("usage: optional --subject-file requires an absolute path.", 400);
    let subject;
    try {
      subject = JSON.parse(source);
    } catch {
      throw new Fault("invalid-subject: expected JSON.", 400);
    }
    console.log(JSON.stringify(await check(stage, subject, options)));
  } catch (error) {
    console.log(
      JSON.stringify({
        status: error instanceof Fault ? error.status : 502,
        payload: null,
        message: error instanceof Fault ? error.message : "io: setup input or cleanup failed.",
      }),
    );
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main();
