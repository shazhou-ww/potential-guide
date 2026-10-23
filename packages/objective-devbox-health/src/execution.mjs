import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { directories, Fault, issue } from "./contract.mjs";
// All subprocesses share a stage deadline; each command also has an individual bound.
export function execute(
  command,
  args,
  {
    deadline = Date.now() + 24000,
    cwd,
    input,
    timeout = 6000,
    evidence,
    signal,
    environment = process.env,
  } = {},
) {
  evidence?.fact("command.started", { command });
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const remaining = Math.min(timeout, deadline - Date.now());
    if (remaining <= 0) {
      reject(new Fault("deadline-exceeded: stage execution budget exhausted.", 504));
      return;
    }
    const env = { ...environment, LC_ALL: "C", LANG: "C", GIT_TERMINAL_PROMPT: "0" };
    for (const name of Object.keys(env)) if (name.startsWith("GIT_")) delete env[name];
    env.GIT_TERMINAL_PROMPT = "0";
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let failure;
    const stop = () => {
      if (child.pid === undefined) return;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") failure = new Fault(`process-cleanup: ${error.code}`);
      }
    };
    const timer = setTimeout(() => {
      failure = new Fault(`command-timeout: ${command}`, 504);
      stop();
    }, remaining);
    const abort = () => {
      failure = new Fault("command-cancelled", 499);
      stop();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    for (const [stream, name] of [
      [child.stdout, "stdout"],
      [child.stderr, "stderr"],
    ]) {
      stream.on("data", (data) => {
        if (name === "stdout") stdout += data;
        else stderr += data;
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 262144) {
          failure = new Fault(`command-output-limit: ${command}`);
          stop();
        }
      });
    }
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") {
        failure = new Fault(`command-stdin: ${command}: ${error.code}`);
        stop();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (error.code === "ENOENT") resolve({ code: 127, stdout: "", stderr: "", missing: true });
      else reject(new Fault(`command-launch: ${command}: ${error.code}`));
    });
    child.once("close", (code) => {
      signal?.removeEventListener("abort", abort);
      clearTimeout(timer);
      evidence?.fact("command.finished", { command, code, failed: failure !== undefined });
      if (failure) reject(failure);
      else resolve({ code, stdout, stderr, missing: false });
    });
    child.stdin.end(input);
  });
}
export async function optionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export async function detectedEnvironment() {
  const release = await readFile("/proc/sys/kernel/osrelease", "utf8");
  const cgroup = await readFile("/proc/1/cgroup", "utf8");
  if ((await optionalFile("/.dockerenv")) !== null || /docker|containerd|kubepods|lxc/.test(cgroup))
    return "container";
  if (/microsoft|wsl/i.test(release)) return "wsl";
  return "native-linux";
}
export async function directoryProblems(subject, writable = false) {
  const problems = [];
  const uid = process.getuid();
  for (const key of directories) {
    const path = subject[key];
    try {
      const info = await lstat(path);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.uid !== uid ||
        (await realpath(path)) !== path
      ) {
        problems.push(
          issue("directory-unusable", {
            directory: key,
            path,
            expected: `real directory owned by uid ${uid}`,
            actual: {
              uid: info.uid,
              directory: info.isDirectory(),
              symlink: info.isSymbolicLink(),
            },
            recovery:
              "Correct ownership and use a canonical directory; do not move or delete user data.",
          }),
        );
        continue;
      }
      if (writable) {
        const probe = join(path, `.pguide-health-${randomUUID()}`);
        let created = false;
        try {
          await writeFile(probe, "machine-health\n", { flag: "wx", mode: 0o600 });
          created = true;
          if ((await readFile(probe, "utf8")) !== "machine-health\n")
            throw new Fault("directory-probe: readback mismatch.");
        } finally {
          if (created) await rm(probe);
        }
      }
    } catch (error) {
      if (!["ENOENT", "EACCES", "EPERM", "EROFS", "ENOSPC", "ENOTDIR"].includes(error.code))
        throw error;
      problems.push(
        issue("directory-unusable", {
          directory: key,
          path,
          actual: error.code,
          recovery: "Provide an existing owned, readable and writable directory.",
        }),
      );
    }
  }
  return problems;
}
