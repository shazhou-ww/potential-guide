#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { hostname, userInfo } from "node:os";
import { join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const stages = ["identity", "system", "toolchains", "order", "sustainability"];
export const minimumVersions = Object.freeze({
  git: "2.30",
  node: "22.13",
  npm: "10",
  tsc: "5",
  python3: "3.10",
  "c++": "10",
  cmake: "3.20",
  ninja: "1.10",
  rustup: "1.25",
  rustc: "1.75",
  cargo: "1.75",
});
export const defaultPolicy = Object.freeze({
  minFreeBytes: 1_073_741_824,
  minFreeInodes: 1024,
  retentionSeconds: 86400,
  historyMinSamples: 3,
  historyMinSpanMs: 1000,
  historyMaxAgeMs: 300000,
  maxCacheGrowthBytesPerSecond: 1_048_576,
  maxLogGrowthBytesPerSecond: 65_536,
  maxPackageIndexAgeSeconds: 604800,
});
export const problemIds = Object.freeze({
  identity: ["identity-mismatch", "environment-mismatch", "directory-unusable", "sudo-unavailable"],
  system: [
    "directory-unusable",
    "capacity-low",
    "inodes-low",
    "unsupported-package-manager",
    "package-database-unhealthy",
    "dns-unavailable",
    "http-unavailable",
  ],
  toolchains: ["directory-unusable", "tool-missing", "tool-version", "toolchain-failed"],
  order: [
    "layout-invalid",
    "directory-unusable",
    "task-registry-invalid",
    "task-orphaned",
    "task-overdue",
    "task-residue",
    "task-process-leftover",
  ],
  sustainability: [
    "directory-unusable",
    "history-insufficient",
    "history-invalid",
    "cache-growth",
    "log-growth",
    "unsupported-package-manager",
    "package-index-stale",
    "updates-pending",
    "reboot-required",
  ],
});
const directories = [
  "home",
  "workspace",
  "scratchDirectory",
  "cacheDirectory",
  "logDirectory",
  "tasksDirectory",
];
const sampleKeys = [
  "hostname",
  "user",
  "home",
  "measuredAt",
  "freeBytes",
  "freeInodes",
  "cacheBytes",
  "logBytes",
];
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string" && v.length > 0 && !/[\0\r\n]/.test(v);
const numeric = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const absolute = (v) =>
  text(v) && v.startsWith("/") && v !== "/" && posix.normalize(v) === v && !v.endsWith("/");
const httpUrl =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Network URLs must reject embedded control characters.
  /^https?:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(?::(?:[1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5]))?(?:\/[^\s@\u0000-\u001f]*)?$/;
const keys = (v, allowed) => record(v) && Object.keys(v).every((k) => allowed.includes(k));
const own = (v, required) => required.every((k) => Object.hasOwn(v, k));
const issue = (id, parameters = {}) => ({ id, parameters });
const envelope = (problems = [], diagnostics = []) => ({
  status: 200,
  payload: { ok: problems.length === 0, problems },
  message: diagnostics.join("; "),
});
class Fault extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
function validSample(v) {
  return (
    keys(v, sampleKeys) &&
    own(v, sampleKeys) &&
    ["hostname", "user"].every((k) => text(v[k])) &&
    absolute(v.home) &&
    sampleKeys.slice(3).every((k) => numeric(v[k]))
  );
}

export function validateSubject(value) {
  const required = ["environment", "user", ...directories, "stacks"];
  if (
    !keys(value, [...required, "target", "minimumVersions", "policy", "network", "history"]) ||
    !own(value, required) ||
    !["container", "native-linux", "wsl"].includes(value.environment) ||
    !text(value.user) ||
    !/^[a-z_][a-z0-9_-]*[$]?$/i.test(value.user) ||
    !directories.every((k) => absolute(value[k])) ||
    !Array.isArray(value.stacks) ||
    new Set(value.stacks).size !== value.stacks.length ||
    !value.stacks.every((v) => ["typescript", "python", "cpp", "rust"].includes(v))
  )
    throw new Fault("invalid-subject: expected the documented Linux machine-health subject.", 400);
  if (
    value.target !== undefined &&
    !(
      (keys(value.target, ["type"]) && value.target.type === "local") ||
      (keys(value.target, ["type", "container"]) &&
        value.target.type === "docker" &&
        text(value.target.container) &&
        /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value.target.container))
    )
  )
    throw new Fault("invalid-subject: invalid target.", 400);
  if (
    value.minimumVersions !== undefined &&
    (!keys(value.minimumVersions, Object.keys(minimumVersions)) ||
      !Object.values(value.minimumVersions).every((v) => text(v) && /^\d+(?:\.\d+)*$/.test(v)))
  )
    throw new Fault("invalid-subject: invalid minimumVersions.", 400);
  if (
    value.policy !== undefined &&
    (!keys(value.policy, Object.keys(defaultPolicy)) ||
      !Object.entries(value.policy).every(
        ([k, v]) =>
          numeric(v) &&
          (k !== "historyMinSamples" || (Number.isSafeInteger(v) && v >= 3)) &&
          (k !== "historyMinSpanMs" || v >= 1000),
      ))
  )
    throw new Fault("invalid-subject: invalid policy.", 400);
  if (
    value.network !== undefined &&
    (!keys(value.network, ["dns", "urls"]) ||
      !own(value.network, ["dns", "urls"]) ||
      !Array.isArray(value.network.dns) ||
      !Array.isArray(value.network.urls) ||
      !value.network.dns.every(
        (v) => text(v) && v.length <= 253 && /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(v),
      ) ||
      !value.network.urls.every((v) => text(v) && httpUrl.test(v)))
  )
    throw new Fault(
      "invalid-subject: network requires DNS names and credential-free HTTP URLs.",
      400,
    );
  if (
    value.history !== undefined &&
    (!Array.isArray(value.history) ||
      value.history.length > 10000 ||
      !value.history.every(validSample))
  )
    throw new Fault("invalid-subject: invalid history sample schema.", 400);
  return {
    ...value,
    target: value.target ?? { type: "local" },
    policy: { ...defaultPolicy, ...value.policy },
    minimumVersions: { ...minimumVersions, ...value.minimumVersions },
  };
}

export function parseToolVersion(output) {
  return /(?:^|\s)v?(\d+\.\d+(?:\.\d+)*)(?:\b|$)/m.exec(output)?.[1];
}
export function compareVersions(actual, expected) {
  const a = actual.split(".").map((part) => part.replace(/^0+(?=\d)/, ""));
  const b = expected.split(".").map((part) => part.replace(/^0+(?=\d)/, ""));
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const first = a[i] ?? "0";
    const second = b[i] ?? "0";
    if (first.length !== second.length) return Math.sign(first.length - second.length);
    if (first !== second) return first > second ? 1 : -1;
  }
  return 0;
}

// All subprocesses share a stage deadline; each command also has an individual bound.
export function execute(
  command,
  args,
  { deadline = Date.now() + 24000, cwd, input, timeout = 6000 } = {},
) {
  return new Promise((resolve, reject) => {
    const remaining = Math.min(timeout, deadline - Date.now());
    if (remaining <= 0) {
      reject(new Fault("deadline-exceeded: stage execution budget exhausted.", 504));
      return;
    }
    const env = { ...process.env, LC_ALL: "C", LANG: "C", GIT_TERMINAL_PROMPT: "0" };
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
      clearTimeout(timer);
      if (failure) reject(failure);
      else resolve({ code, stdout, stderr, missing: false });
    });
    child.stdin.end(input);
  });
}

async function optionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function detectedEnvironment() {
  const release = await readFile("/proc/sys/kernel/osrelease", "utf8");
  const cgroup = await readFile("/proc/1/cgroup", "utf8");
  if ((await optionalFile("/.dockerenv")) !== null || /docker|containerd|kubepods|lxc/.test(cgroup))
    return "container";
  if (/microsoft|wsl/i.test(release)) return "wsl";
  return "native-linux";
}
async function directoryProblems(subject, writable = false) {
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

export function sudoUnrestricted(output) {
  const start = output.search(/^\s*\([^)\n]+\)\s+/m);
  if (start === -1) return false;
  const grants = output.slice(start);
  return (
    grants
      .split("\n")
      .some((line) => /^\s*\(ALL(?:\s*:\s*ALL)?\)\s+NOPASSWD:\s*ALL\s*$/.test(line)) &&
    !/(?:^|\s|,)![^\s]/m.test(grants)
  );
}
async function identity(subject, context) {
  const actual = userInfo();
  const problems = [];
  if (
    actual.uid === 0 ||
    actual.username !== subject.user ||
    actual.homedir !== subject.home ||
    process.env.HOME !== subject.home
  )
    problems.push(
      issue("identity-mismatch", {
        expected: { user: subject.user, home: subject.home, nonroot: true },
        actual: {
          user: actual.username,
          home: actual.homedir,
          HOME: process.env.HOME ?? "",
          uid: actual.uid,
        },
        recovery:
          "Run as the declared non-root account with its HOME; do not hide a root invocation.",
      }),
    );
  const environment = await detectedEnvironment();
  if (environment !== subject.environment)
    problems.push(
      issue("environment-mismatch", { expected: subject.environment, actual: environment }),
    );
  problems.push(...(await directoryProblems(subject)));
  const sudo = await execute("sudo", ["-n", "-l"], context);
  const unrestricted = sudoUnrestricted(sudo.stdout);
  if (sudo.code !== 0 || !unrestricted)
    problems.push(
      issue("sudo-unavailable", {
        expected: "(ALL : ALL) NOPASSWD: ALL from sudo -n -l",
        actual: sudo.missing
          ? "sudo missing"
          : `exit ${sudo.code}; unrestricted grant=${unrestricted}`,
        recovery:
          "Have an administrator explicitly grant this trusted account unrestricted noninteractive sudo.",
      }),
    );
  return envelope(problems);
}

export function capacityProblems(freeBytes, freeInodes, policy, path = "") {
  const problems = [];
  if (freeBytes < policy.minFreeBytes)
    problems.push(
      issue("capacity-low", {
        path,
        expected: policy.minFreeBytes,
        actual: freeBytes,
        unit: "bytes",
      }),
    );
  if (freeInodes < policy.minFreeInodes)
    problems.push(
      issue("inodes-low", {
        path,
        expected: policy.minFreeInodes,
        actual: freeInodes,
        unit: "inodes",
      }),
    );
  return problems;
}
async function packageManager(context) {
  const release = await readFile("/etc/os-release", "utf8");
  const id = /^ID=(?:"([^"]+)"|([^\n]+))$/m.exec(release);
  if (!["debian", "ubuntu"].includes(id?.[1] ?? id?.[2]))
    return issue("unsupported-package-manager", {
      expected: "Debian or Ubuntu with dpkg and apt-get",
      actual: id?.[1] ?? id?.[2] ?? "unknown",
    });
  for (const tool of ["dpkg", "apt-get"]) {
    const result = await execute(tool, ["--version"], context);
    if (result.code !== 0)
      return issue("unsupported-package-manager", {
        tool,
        expected: "available",
        actual: result.code,
      });
  }
  return null;
}
async function system(subject, context) {
  const problems = await directoryProblems(subject, true);
  if (problems.length) return envelope(problems);
  for (const path of new Set(directories.map((key) => subject[key]))) {
    const fs = await statfs(path, { bigint: true });
    problems.push(
      ...capacityProblems(Number(fs.bavail * fs.bsize), Number(fs.ffree), subject.policy, path),
    );
  }
  const unsupported = await packageManager(context);
  if (unsupported) problems.push(unsupported);
  else {
    const audit = await execute("dpkg", ["--audit"], context);
    if (audit.code !== 0 || audit.stdout.trim() || audit.stderr.trim())
      problems.push(
        issue("package-database-unhealthy", {
          tool: "dpkg --audit",
          actual: audit.stdout + audit.stderr,
          code: audit.code,
        }),
      );
  }
  for (const host of subject.network?.dns ?? []) {
    const code = "import{lookup}from'node:dns/promises';await lookup(process.argv[1]);";
    const result = await execute(
      process.execPath,
      ["--input-type=module", "-e", code, host],
      context,
    );
    if (result.code !== 0)
      problems.push(
        issue("dns-unavailable", {
          host,
          expected: "resolvable",
          actual: result.stderr.slice(0, 2048),
        }),
      );
  }
  for (const url of subject.network?.urls ?? []) {
    const code =
      "const r=await fetch(process.argv[1],{signal:AbortSignal.timeout(4000),redirect:'error'});await r.body?.cancel();if(!r.ok)throw Error('HTTP '+r.status);";
    const result = await execute(
      process.execPath,
      ["--input-type=module", "-e", code, url],
      context,
    );
    if (result.code !== 0)
      problems.push(
        issue("http-unavailable", {
          url,
          expected: "HTTP 2xx without redirect",
          actual: result.stderr.slice(0, 2048),
        }),
      );
  }
  return envelope(problems, [
    ...(!subject.network?.dns.length ? ["DNS: not applicable (no declared endpoints)"] : []),
    ...(!subject.network?.urls.length ? ["HTTP: not applicable (no declared endpoints)"] : []),
  ]);
}

async function toolchains(subject, context) {
  const problems = await directoryProblems(subject);
  if (problems.length) return envelope(problems);
  const tools = [
    "git",
    ...(subject.stacks.includes("typescript") ? ["node", "npm", "tsc"] : []),
    ...(subject.stacks.includes("python") ? ["python3"] : []),
    ...(subject.stacks.includes("cpp") ? ["c++", "cmake", "ninja"] : []),
    ...(subject.stacks.includes("rust") ? ["rustup", "rustc", "cargo"] : []),
  ];
  const unavailable = new Set();
  for (const tool of tools) {
    const result = await execute(tool, ["--version"], context);
    if (result.missing) {
      unavailable.add(tool);
      problems.push(
        issue("tool-missing", {
          tool,
          expected: subject.minimumVersions[tool],
          actual: "ENOENT",
          recovery: "Install the declared tool explicitly outside this check.",
        }),
      );
      continue;
    }
    const actual = parseToolVersion(result.stdout + result.stderr);
    if (
      result.code !== 0 ||
      !actual ||
      compareVersions(actual, subject.minimumVersions[tool]) < 0
    ) {
      unavailable.add(tool);
      problems.push(
        issue("tool-version", {
          tool,
          expected: subject.minimumVersions[tool],
          actual: actual ?? "unparseable",
          code: result.code,
          recovery: "Select an installed supported toolchain; no automatic download is attempted.",
        }),
      );
    }
  }
  const scratch = await mkdtemp(join(subject.scratchDirectory, "pguide-health-"));
  const expected = "pguide-health-ok";
  const run = async (stack, command, args, output) => {
    const result = await execute(command, args, { ...context, cwd: scratch, timeout: 10000 });
    if (result.code !== 0 || (output !== undefined && result.stdout.trim() !== output)) {
      problems.push(
        issue("toolchain-failed", {
          stack,
          tool: command,
          expected: output ?? "exit 0",
          actual: {
            code: result.code,
            stdout: result.stdout.slice(0, 4096),
            stderr: result.stderr.slice(0, 4096),
          },
          recovery:
            "Repair this compiler, linker, runtime or offline standard library; preserve workspace data.",
        }),
      );
      return false;
    }
    return true;
  };
  try {
    if (
      subject.stacks.includes("typescript") &&
      !["node", "npm", "tsc"].some((t) => unavailable.has(t))
    ) {
      await writeFile(
        join(scratch, "proof.ts"),
        `const value: string = "${expected}"; console.log(value);\n`,
      );
      if (
        await run("typescript", "tsc", [
          "--strict",
          "--target",
          "ES2022",
          "--module",
          "commonjs",
          "--outDir",
          "ts-out",
          "proof.ts",
        ])
      )
        await run("typescript", "node", [join(scratch, "ts-out", "proof.js")], expected);
    }
    if (subject.stacks.includes("python") && !unavailable.has("python3")) {
      if (await run("python", "python3", ["-m", "venv", join(scratch, "venv")]))
        await run(
          "python",
          join(scratch, "venv", "bin", "python"),
          ["-c", `import sys; assert sys.prefix != sys.base_prefix; print("${expected}")`],
          expected,
        );
    }
    if (
      subject.stacks.includes("cpp") &&
      !["c++", "cmake", "ninja"].some((t) => unavailable.has(t))
    ) {
      await writeFile(
        join(scratch, "proof.cpp"),
        `#include <iostream>\nint main(){std::cout<<"${expected}\\n";}\n`,
      );
      await writeFile(
        join(scratch, "CMakeLists.txt"),
        "cmake_minimum_required(VERSION 3.20)\nproject(health LANGUAGES CXX)\nadd_executable(proof proof.cpp)\ntarget_compile_features(proof PRIVATE cxx_std_17)\n",
      );
      if (
        (await run("cpp", "cmake", [
          "-S",
          scratch,
          "-B",
          join(scratch, "cpp-out"),
          "-G",
          "Ninja",
          "-DCMAKE_CXX_COMPILER=c++",
        ])) &&
        (await run("cpp", "cmake", ["--build", join(scratch, "cpp-out")]))
      )
        await run("cpp", join(scratch, "cpp-out", "proof"), [], expected);
    }
    if (
      subject.stacks.includes("rust") &&
      !["rustup", "rustc", "cargo"].some((t) => unavailable.has(t))
    ) {
      await writeFile(join(scratch, "proof.rs"), `fn main(){println!("${expected}");}\n`);
      await writeFile(
        join(scratch, "Cargo.toml"),
        '[package]\nname="pguide-health-proof"\nversion="0.0.0"\nedition="2021"\n[[bin]]\nname="proof"\npath="proof.rs"\n[workspace]\n',
      );
      if (
        await run("rust", "cargo", [
          "build",
          "--offline",
          "--manifest-path",
          join(scratch, "Cargo.toml"),
          "--target-dir",
          join(scratch, "rust-out"),
        ])
      )
        await run("rust", join(scratch, "rust-out", "debug", "proof"), [], expected);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return envelope(
    problems,
    subject.stacks.length
      ? []
      : ["Stack proofs: not applicable (no declared stacks); Git still required"],
  );
}

export function validateTask(task, scratchDirectory) {
  if (
    !keys(task, [
      "id",
      "state",
      "pid",
      "startedAt",
      "finishedAt",
      "deadlineAt",
      "temporaryDirectory",
    ]) ||
    !own(task, ["id", "state", "startedAt"]) ||
    !text(task.id) ||
    !["active", "finished"].includes(task.state) ||
    !numeric(task.startedAt) ||
    (task.pid !== undefined && (!Number.isSafeInteger(task.pid) || task.pid <= 0)) ||
    (task.state === "active" && task.finishedAt !== undefined) ||
    (task.state === "finished" && !numeric(task.finishedAt)) ||
    (task.finishedAt !== undefined && task.finishedAt < task.startedAt) ||
    (task.deadlineAt !== undefined &&
      (!numeric(task.deadlineAt) || task.deadlineAt < task.startedAt)) ||
    (task.temporaryDirectory !== undefined &&
      (!absolute(task.temporaryDirectory) ||
        posix.dirname(task.temporaryDirectory) !== scratchDirectory))
  )
    return false;
  return true;
}
export function evaluateTasks(tasks, subject, now, livePids, residuePaths) {
  const problems = [];
  const seen = new Set();
  for (const task of tasks) {
    if (
      !validateTask(task, subject.scratchDirectory) ||
      seen.has(task.id) ||
      task.startedAt > now ||
      (task.finishedAt ?? 0) > now
    ) {
      problems.push(
        issue("task-registry-invalid", {
          id: typeof task?.id === "string" ? task.id : "unknown",
          expected: "unique, valid task record without future timestamps",
        }),
      );
      continue;
    }
    seen.add(task.id);
    const live = task.pid !== undefined && livePids.has(task.pid);
    if (task.state === "active") {
      if (!live) problems.push(issue("task-orphaned", { id: task.id, pid: task.pid ?? null }));
      if (task.deadlineAt !== undefined && now > task.deadlineAt)
        problems.push(issue("task-overdue", { id: task.id, deadlineAt: task.deadlineAt, now }));
    } else {
      if (live) problems.push(issue("task-process-leftover", { id: task.id, pid: task.pid }));
      if (
        task.temporaryDirectory &&
        residuePaths.has(task.temporaryDirectory) &&
        now - task.finishedAt > subject.policy.retentionSeconds * 1000
      )
        problems.push(
          issue("task-residue", {
            id: task.id,
            path: task.temporaryDirectory,
            finishedAt: task.finishedAt,
            recovery:
              "Review retained output and uncommitted work before manually cleaning the registered directory.",
          }),
        );
    }
  }
  return problems;
}
function processLive(pid) {
  if (pid > 2147483647) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}
export function layoutProblems(subject) {
  const entries = directories.filter((k) => k !== "home").map((key) => [key, subject[key]]);
  const problems = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [a, first] = entries[i];
      const [b, second] = entries[j];
      if (first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`))
        problems.push(
          issue("layout-invalid", {
            directories: [a, b],
            expected: "distinct, non-overlapping managed directories",
            actual: [first, second],
          }),
        );
    }
  }
  if (entries.some(([, path]) => path === subject.home || subject.home.startsWith(`${path}/`)))
    problems.push(
      issue("layout-invalid", { expected: "managed paths must not contain the home directory" }),
    );
  return problems;
}
async function order(subject, context) {
  const problems = [...layoutProblems(subject), ...(await directoryProblems(subject))];
  if (problems.length) return envelope(problems);
  const records = [];
  const livePids = new Set();
  const residues = new Set();
  let count = 0;
  for (const name of await readdir(subject.tasksDirectory)) {
    if (Date.now() > context.deadline || ++count > 10000)
      throw new Fault("task-registry-bound: directory traversal budget exceeded.", 504);
    if (!name.endsWith(".json")) continue;
    const path = join(subject.tasksDirectory, name);
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid() ||
      info.size > 65536
    ) {
      problems.push(
        issue("task-registry-invalid", {
          file: name,
          expected: "owned regular JSON file <=65536 bytes",
        }),
      );
      continue;
    }
    let task;
    try {
      task = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      problems.push(issue("task-registry-invalid", { file: name, actual: "invalid JSON" }));
      continue;
    }
    if (!validateTask(task, subject.scratchDirectory)) {
      problems.push(
        issue("task-registry-invalid", {
          file: name,
          expected: "valid task schema with an immediate owned scratch child",
        }),
      );
      continue;
    }
    records.push(task);
    if (task.pid !== undefined && processLive(task.pid)) livePids.add(task.pid);
    if (task.temporaryDirectory) {
      try {
        const residue = await lstat(task.temporaryDirectory);
        if (
          !residue.isDirectory() ||
          residue.isSymbolicLink() ||
          residue.uid !== process.getuid() ||
          (await realpath(task.temporaryDirectory)) !== task.temporaryDirectory
        )
          problems.push(
            issue("task-registry-invalid", {
              id: task.id,
              actual: "temporaryDirectory is not an owned canonical directory",
            }),
          );
        residues.add(task.temporaryDirectory);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  problems.push(...evaluateTasks(records, subject, Date.now(), livePids, residues));
  return envelope(problems, [
    "Only registered tasks are inspected; no tracked process or user file is killed or deleted",
  ]);
}

export function evaluateHistory(history, subject, identityValue, now) {
  const p = subject.policy;
  if (!history?.length)
    return [
      issue("history-insufficient", {
        expected: `${p.historyMinSamples} samples spanning ${p.historyMinSpanMs}ms`,
        actual: 0,
      }),
    ];
  let previous = -1;
  for (const entry of history) {
    if (
      !validSample(entry) ||
      entry.hostname !== identityValue.hostname ||
      entry.user !== subject.user ||
      entry.home !== subject.home ||
      entry.measuredAt <= previous ||
      entry.measuredAt > now
    ) {
      return [
        issue("history-invalid", {
          expected:
            "matching hostname/user/home, nonnegative metrics and strictly increasing nonfuture timestamps",
        }),
      ];
    }
    previous = entry.measuredAt;
  }
  const first = history[0];
  const last = history.at(-1);
  const span = last.measuredAt - first.measuredAt;
  if (
    history.length < p.historyMinSamples ||
    span < p.historyMinSpanMs ||
    now - last.measuredAt > p.historyMaxAgeMs
  )
    return [
      issue("history-insufficient", {
        expected: {
          samples: p.historyMinSamples,
          spanMs: p.historyMinSpanMs,
          maxAgeMs: p.historyMaxAgeMs,
        },
        actual: { samples: history.length, spanMs: span, ageMs: now - last.measuredAt },
      }),
    ];
  const problems = [];
  for (const [metric, limit, id] of [
    ["cacheBytes", p.maxCacheGrowthBytesPerSecond, "cache-growth"],
    ["logBytes", p.maxLogGrowthBytesPerSecond, "log-growth"],
  ]) {
    const growth = (last[metric] - first[metric]) / (span / 1000);
    if (growth > limit)
      problems.push(
        issue(id, {
          expected: limit,
          actual: growth,
          unit: "bytes/second",
          spanMs: span,
          recovery:
            "Review growth and configure bounded retention; never blindly delete caches or logs.",
        }),
      );
  }
  return problems;
}
async function treeBytes(root, deadline) {
  let bytes = 0;
  let count = 0;
  const pending = [root];
  while (pending.length) {
    if (Date.now() > deadline || ++count > 100000)
      throw new Fault("sample-bound: directory traversal budget exceeded.", 504);
    const path = pending.pop();
    const info = await lstat(path);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      for (const entry of await readdir(path)) pending.push(join(path, entry));
    } else if (info.isFile()) bytes += info.size;
  }
  return bytes;
}
async function localSample(subject, context) {
  const problems = [...layoutProblems(subject), ...(await directoryProblems(subject))];
  if (problems.length) throw new Fault(`sample-directory: ${JSON.stringify(problems)}`, 409);
  const identityValue = userInfo();
  if (
    identityValue.uid === 0 ||
    identityValue.username !== subject.user ||
    identityValue.homedir !== subject.home ||
    process.env.HOME !== subject.home
  )
    throw new Fault("sample-identity: run as the declared non-root user with its HOME.", 409);
  const fs = await statfs(subject.workspace, { bigint: true });
  const cacheBytes = await treeBytes(subject.cacheDirectory, context.deadline);
  const logBytes = await treeBytes(subject.logDirectory, context.deadline);
  return {
    hostname: hostname(),
    user: identityValue.username,
    home: identityValue.homedir,
    measuredAt: Date.now(),
    freeBytes: Number(fs.bavail * fs.bsize),
    freeInodes: Number(fs.ffree),
    cacheBytes,
    logBytes,
  };
}
export function packageIndexProblem(indexTimes, stampTime, policy, now) {
  const source = stampTime === undefined ? "oldest Packages mtime" : "update-success-stamp mtime";
  const evidence = stampTime === undefined ? Math.min(...indexTimes) : stampTime;
  if (
    !indexTimes.length ||
    !numeric(evidence) ||
    indexTimes.some((time) => !numeric(time) || time > now) ||
    evidence > now ||
    now - evidence > policy.maxPackageIndexAgeSeconds * 1000
  )
    return issue("package-index-stale", {
      expected: policy.maxPackageIndexAgeSeconds,
      actual: !indexTimes.length
        ? "missing Packages indexes"
        : numeric(evidence)
          ? (now - evidence) / 1000
          : "invalid refresh evidence",
      source,
      unit: "seconds",
      recovery:
        "Explicitly refresh apt indexes outside this check; record an update-success-stamp only after a successful refresh.",
    });
  return null;
}
async function sustainability(subject, context) {
  const problems = await directoryProblems(subject);
  if (problems.length) return envelope(problems);
  problems.push(...evaluateHistory(subject.history, subject, { hostname: hostname() }, Date.now()));
  const unsupported = await packageManager(context);
  if (unsupported) problems.push(unsupported);
  else {
    const lists = "/var/lib/apt/lists";
    const indexes = [];
    try {
      let count = 0;
      for (const name of await readdir(lists)) {
        if (Date.now() > context.deadline || ++count > 10000)
          throw new Fault("package-index-bound: directory traversal budget exceeded.", 504);
        if (/(?:^|_)Packages(?:\.(?:lz4|gz|xz|bz2|zst))?$/.test(name)) {
          const info = await lstat(join(lists, name));
          if (info.isFile() && !info.isSymbolicLink()) indexes.push(info.mtimeMs);
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    let stampTime;
    try {
      const stamp = await lstat("/var/lib/apt/periodic/update-success-stamp");
      stampTime =
        stamp.isFile() && !stamp.isSymbolicLink() && stamp.uid === 0 ? stamp.mtimeMs : null;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const indexProblem = packageIndexProblem(indexes, stampTime, subject.policy, Date.now());
    if (indexProblem) problems.push(indexProblem);
    const upgrade = await execute(
      "apt-get",
      ["-s", "-o", "Debug::NoLocking=1", "upgrade"],
      context,
    );
    if (upgrade.code !== 0)
      throw new Fault(
        `package-upgrade-simulation: exit ${upgrade.code}: ${upgrade.stderr.slice(0, 2048)}`,
      );
    const summary =
      /(\d+) upgraded, (\d+) newly installed, (\d+) to remove and (\d+) not upgraded/.exec(
        upgrade.stdout,
      );
    if (!summary) throw new Fault("package-upgrade-simulation: unrecognized apt-get summary.");
    if (summary.slice(1).some((number) => Number(number) > 0))
      problems.push(
        issue("updates-pending", {
          actual: {
            upgraded: Number(summary[1]),
            installed: Number(summary[2]),
            removed: Number(summary[3]),
            held: Number(summary[4]),
          },
          recovery:
            "Review and apply appropriate updates explicitly; this check never installs packages.",
        }),
      );
  }
  if (subject.environment === "native-linux") {
    if ((await optionalFile("/var/run/reboot-required")) !== null)
      problems.push(
        issue("reboot-required", {
          recovery: "Schedule a controlled native-machine reboot after saving work.",
        }),
      );
  }
  return envelope(problems, [
    "Package update simulation uses local indexes only; it is not a live security-status proof",
    ...(subject.environment === "native-linux"
      ? []
      : ["Reboot: not applicable (container/WSL host kernel control excluded)"]),
  ]);
}

const bootstrap =
  "let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>2097152)throw Error('transport-input-limit');}const {source,stage,subject}=JSON.parse(text);const m=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));console.log(JSON.stringify(stage==='sample'?await m.sample(subject):await m.check(stage,subject)));";
async function remote(stage, subject) {
  const source = await readFile(fileURLToPath(import.meta.url), "utf8");
  const result = await execute(
    "docker",
    [
      "exec",
      "-i",
      "--user",
      subject.user,
      subject.target.container,
      "node",
      "--input-type=module",
      "-e",
      bootstrap,
    ],
    {
      input: JSON.stringify({ source, stage, subject: { ...subject, target: { type: "local" } } }),
      deadline: Date.now() + 27000,
      timeout: 27000,
    },
  );
  if (result.code !== 0)
    throw new Fault(
      `docker-transport: ${result.missing ? "docker missing" : `exit ${result.code}`}: ${result.stderr.slice(0, 2048)}`,
    );
  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Fault("docker-transport: response is not a single JSON envelope.");
  }
  if (
    !keys(output, ["status", "payload", "message"]) ||
    !own(output, ["status", "payload", "message"]) ||
    !Number.isInteger(output.status) ||
    output.status < 100 ||
    output.status > 599 ||
    typeof output.message !== "string"
  )
    throw new Fault("docker-transport: invalid envelope.");
  if (output.status !== 200) {
    if (output.payload !== null || !output.message.trim())
      throw new Fault("docker-transport: invalid fault envelope.");
  } else if (stage === "sample") {
    if (!validSample(output.payload)) throw new Fault("docker-transport: invalid sample.");
  } else if (
    !keys(output.payload, ["ok", "problems"]) ||
    !own(output.payload, ["ok", "problems"]) ||
    typeof output.payload.ok !== "boolean" ||
    !Array.isArray(output.payload.problems) ||
    output.payload.ok !== (output.payload.problems.length === 0) ||
    !output.payload.problems.every(
      (p) =>
        keys(p, ["id", "parameters"]) &&
        own(p, ["id", "parameters"]) &&
        problemIds[stage].includes(p.id) &&
        record(p.parameters),
    )
  )
    throw new Fault("docker-transport: invalid check result.");
  return output;
}
function failure(error) {
  return {
    status: error instanceof Fault ? error.status : 500,
    payload: null,
    message:
      error instanceof Fault
        ? error.message
        : `health-check-fault: ${error.code ?? error.name}: ${error.message}`,
  };
}
async function invoke(stage, value) {
  try {
    if (![...stages, "sample"].includes(stage)) throw new Fault("invalid-stage.", 400);
    const subject = validateSubject(value);
    if (subject.target.type === "docker") return await remote(stage, subject);
    if (process.platform !== "linux")
      throw new Fault("unsupported-platform: local execution requires Linux (Debian/Ubuntu).", 501);
    const context = { deadline: Date.now() + 24000 };
    if (stage === "sample")
      return { status: 200, payload: await localSample(subject, context), message: "" };
    return await { identity, system, toolchains, order, sustainability }[stage](subject, context);
  } catch (error) {
    return failure(error);
  }
}
export async function check(stage, subject) {
  if (!stages.includes(stage))
    return failure(new Fault("invalid-stage: sample is not a Pilot check.", 400));
  return invoke(stage, subject);
}
export async function sample(subject) {
  return invoke("sample", subject);
}
async function stdin() {
  let timer;
  try {
    return await Promise.race([
      (async () => {
        let data = "";
        for await (const chunk of process.stdin) {
          data += chunk;
          if (Buffer.byteLength(data) > 2_097_152) throw new Fault("subject-input-limit.", 400);
        }
        return data;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Fault("subject-input-timeout.", 504));
          process.stdin.destroy();
        }, 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function main(stage) {
  let output;
  try {
    const args = process.argv.slice(2);
    if (stage === undefined) stage = args.shift();
    let data;
    if (args.length === 0) data = await stdin();
    else if (args.length === 2 && args[0] === "--subject-file") {
      const info = await stat(args[1]);
      if (!info.isFile()) throw new Fault("invalid-subject-file: expected a regular file.", 400);
      if (info.size > 2_097_152) throw new Fault("subject-input-limit.", 400);
      data = await readFile(args[1], "utf8");
    } else throw new Fault("usage: health-check.mjs <stage|sample> [--subject-file path]", 400);
    let subject;
    try {
      subject = JSON.parse(data);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new Fault("invalid-subject: malformed JSON.", 400);
    }
    output = await invoke(stage, subject);
  } catch (error) {
    output = failure(error);
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
  return output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
