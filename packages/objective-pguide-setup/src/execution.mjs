import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { Fault, outputLimit, Problem } from "./contract.mjs";
export function launch(command, args, options) {
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
export async function descendants(pid) {
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
export function executionContext(subject, directory, signal, deadline) {
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
