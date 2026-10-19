import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "cross-spawn";

const root = fileURLToPath(new URL("../", import.meta.url));
const objective = join(root, "objectives", "development-machine-health");
const helper = join(objective, "health-check.mjs");
const cli = join(root, "packages", "pguide", "dist", "bin", "probe.js");
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

function execute(command, args, { input, cwd = root, timeout = 60000 } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    let failure;
    const timer = setTimeout(() => {
      failure = new Error(`${command} exceeded ${timeout}ms`);
      child.kill();
    }, timeout);
    const collect = (stream) => (chunk) => {
      if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 4 * 1024 * 1024) {
        failure = new Error(`${command} exceeded its output budget`);
        child.kill();
      }
    };
    child.stdout.setEncoding("utf8").on("data", collect("stdout"));
    child.stderr.setEncoding("utf8").on("data", collect("stderr"));
    child.once("error", (error) => {
      failure = error;
    });
    child.stdin.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`));
      else done(stdout.trim());
    });
    child.stdin.end(input);
  });
}

export function baselineSubject(container) {
  return {
    target: { type: "docker", container },
    environment: "container",
    user: "agent",
    home: "/home/agent",
    workspace: "/home/agent/work",
    scratchDirectory: "/home/agent/tmp",
    cacheDirectory: "/home/agent/cache",
    logDirectory: "/home/agent/logs",
    tasksDirectory: "/home/agent/tasks",
    stacks: ["typescript", "python", "cpp", "rust"],
    network: { dns: ["localhost"], urls: ["http://127.0.0.1:18080/health"] },
  };
}

async function verify(reportPath) {
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    scope: "local Docker only; controlled short-window samples, not long-term reliability",
    scenarios: [],
    cleaned: false,
  };
  await mkdir(join(root, ".cache"), { recursive: true });
  const scratch = await mkdtemp(join(root, ".cache", "development-health-"));
  const tag = `pguide-development-health:${randomUUID()}`;
  const containers = new Set();
  const cleanupErrors = [];
  let failure;
  try {
    report.docker = JSON.parse(await execute("docker", ["version", "--format", "{{json .}}"]));
    assert.equal(
      await execute("docker", ["info", "--format", "{{.OSType}}"]),
      "linux",
      "Linux Docker engine required",
    );
    const changed = await execute("git", [
      "status",
      "--porcelain",
      "--",
      "objectives/development-machine-health",
      "scripts/verify-development-health.mjs",
    ]);
    assert.equal(changed, "", "Commit the exact Pilot and runner before verification");
    report.commit = await execute("git", ["rev-parse", "HEAD"]);
    report.pilot = `git+${pathToFileURL(root).href}#objectives/development-machine-health/pilot.yaml`;
    const context = join(scratch, "build");
    await mkdir(context);
    for (const name of ["Dockerfile", ".dockerignore", "server.mjs"])
      await copyFile(join(objective, "docker", name), join(context, name));
    const packed = JSON.parse(
      await execute("npm", ["pack", "typescript@5.9.3", "--json", "--pack-destination", context]),
    )[0];
    assert.equal(packed.name, "typescript");
    assert.equal(packed.version, "5.9.3");
    report.typescript = { version: packed.version, integrity: packed.integrity };
    await copyFile(join(context, packed.filename), join(context, "typescript.tgz"));
    await execute("docker", ["build", "--tag", tag, context], { timeout: 600000 });
    report.image = JSON.parse(await execute("docker", ["image", "inspect", tag]))[0].Id;

    async function inContainer(name, code, user = "root") {
      return execute("docker", [
        "exec",
        "--user",
        user,
        name,
        "node",
        "--input-type=module",
        "-e",
        code,
      ]);
    }
    async function direct(stage, subject) {
      return JSON.parse(
        await execute(process.execPath, [helper, stage], {
          input: JSON.stringify(subject),
          timeout: 60000,
        }),
      );
    }
    async function samples(subject) {
      const history = [];
      for (let index = 0; index < 3; index++) {
        const result = await direct("sample", subject);
        assert.equal(result.status, 200, JSON.stringify(result));
        history.push(result.payload);
        if (index < 2) await pause(650);
      }
      return history;
    }
    async function probe(subject) {
      const path = join(scratch, "subject.json");
      await writeFile(path, JSON.stringify(subject));
      return JSON.parse(
        await execute(
          process.execPath,
          [
            cli,
            "--pilot",
            report.pilot,
            "--revision",
            report.commit,
            "--subject-file",
            path,
            "--format",
            "json",
          ],
          { timeout: 180000 },
        ),
      );
    }
    async function scenario(id, action) {
      process.stderr.write(`Docker health: ${id}\n`);
      const name = `pguide-health-${randomUUID()}`;
      let entry;
      try {
        await execute("docker", [
          "run",
          "--detach",
          "--name",
          name,
          "--network",
          "none",
          "--cpus",
          "2",
          "--memory",
          "2g",
          "--pids-limit",
          "256",
          "--tmpfs",
          "/health-quota:rw,size=2m,nr_inodes=64,uid=2000,gid=2000,mode=0700",
          tag,
        ]);
        containers.add(name);
        await inContainer(
          name,
          `
          const response = await fetch("http://127.0.0.1:18080/health");
          if(response.status !== 200) throw Error("fixture is not ready");
        `,
          "agent",
        );
        const subject = baselineSubject(name);
        const observation = await action({ name, subject, direct, probe, samples, inContainer });
        entry = { id, passed: true, observation };
      } catch (error) {
        entry = { id, passed: false, error: String(error) };
        throw error;
      } finally {
        if (entry) report.scenarios.push(entry);
        if (containers.has(name)) {
          await execute("docker", ["rm", "--force", name]);
          containers.delete(name);
        }
      }
    }
    function healthy(result) {
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.payload.current.levelId, "terminal", JSON.stringify(result));
      assert.deepEqual(result.payload.problems, []);
      return result;
    }
    function gap(result, level, id, expectedParameters = {}) {
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.payload.current.levelId, level, JSON.stringify(result));
      const problem = result.payload.problems.find((entry) => entry.ref.problemId === id);
      assert.ok(problem, `Expected ${id}: ${JSON.stringify(result)}`);
      for (const [key, value] of Object.entries(expectedParameters))
        assert.deepEqual(problem.parameters[key], value, JSON.stringify(problem));
      return result;
    }

    await scenario("healthy-all-four-stacks", async ({ subject, samples, probe }) => {
      subject.history = await samples(subject);
      return healthy(await probe(subject));
    });
    await scenario("history-required", async ({ subject, probe }) =>
      gap(await probe(subject), "orderly", "history-insufficient"),
    );
    await scenario("docker-transport-does-not-fallback", async ({ subject, direct }) => {
      const result = await direct("identity", {
        ...subject,
        target: { type: "docker", container: `missing-${randomUUID()}` },
      });
      assert.notEqual(result.status, 200, JSON.stringify(result));
      assert.equal(result.payload, null);
      assert.ok(result.message.length > 0);
      return result;
    });
    await scenario("invalid-input-explicitly-rejected", async ({ subject, direct }) => {
      const result = await direct("identity", { ...subject, unexpected: true });
      assert.equal(result.status, 400, JSON.stringify(result));
      assert.equal(result.payload, null);
      return result;
    });
    await scenario(
      "home-owner-gap-and-recovery",
      async ({ name, subject, probe, samples, inContainer }) => {
        await inContainer(
          name,
          "import{chown}from'node:fs/promises';await chown('/home/agent/work',0,0)",
        );
        const failed = gap(await probe(subject), "initial", "directory-unavailable");
        await inContainer(
          name,
          "import{chown}from'node:fs/promises';await chown('/home/agent/work',2000,2000)",
        );
        subject.history = await samples(subject);
        return { failed, recovered: healthy(await probe(subject)) };
      },
    );
    await scenario(
      "sudo-gap-and-recovery",
      async ({ name, subject, probe, samples, inContainer }) => {
        await inContainer(
          name,
          "import{rename}from'node:fs/promises';await rename('/etc/sudoers.d/agent','/tmp/health-agent-sudo')",
        );
        const failed = gap(await probe(subject), "initial", "sudo-unavailable");
        await inContainer(
          name,
          "import{rename}from'node:fs/promises';await rename('/tmp/health-agent-sudo','/etc/sudoers.d/agent')",
        );
        subject.history = await samples(subject);
        return { failed, recovered: healthy(await probe(subject)) };
      },
    );
    await scenario("filesystem-space-gap", async ({ name, subject, probe, inContainer }) => {
      subject.workspace = "/health-quota";
      subject.policy = { minFreeBytes: 1024 * 1024, minFreeInodes: 0 };
      await inContainer(
        name,
        "import{writeFile}from'node:fs/promises';await writeFile('/health-quota/fill',Buffer.alloc(1536*1024))",
        "agent",
      );
      return gap(await probe(subject), "managed", "disk-space-low");
    });
    await scenario("filesystem-inode-gap", async ({ name, subject, probe, inContainer }) => {
      subject.workspace = "/health-quota";
      subject.policy = { minFreeBytes: 0, minFreeInodes: 16 };
      await inContainer(
        name,
        "import{writeFile}from'node:fs/promises';for(let i=0;i<55;i++)await writeFile('/health-quota/f'+i,'')",
        "agent",
      );
      return gap(await probe(subject), "managed", "disk-inodes-low");
    });
    await scenario("required-endpoint-gap", async ({ subject, probe }) => {
      subject.network.urls = ["http://127.0.0.1:18080/unavailable"];
      return gap(await probe(subject), "managed", "network-unavailable");
    });
    await scenario("package-manager-incomplete", async ({ name, subject, probe, inContainer }) => {
      await inContainer(
        name,
        `import{writeFile}from'node:fs/promises';
        await writeFile('/var/lib/dpkg/updates/0000','invalid package database update\\n');`,
      );
      return gap(await probe(subject), "managed", "package-manager-unhealthy");
    });
    await scenario("version-gap", async ({ subject, probe }) => {
      subject.minimumVersions = { node: "999.0.0" };
      return gap(await probe(subject), "system-ready", "tool-version-mismatch");
    });
    for (const [stack, binary] of [
      ["typescript", "/usr/local/bin/tsc"],
      ["python", "/usr/bin/python3"],
      ["cpp", "/usr/bin/c++"],
      ["rust", "/opt/cargo/bin/cargo"],
    ]) {
      await scenario(`${stack}-missing`, async ({ name, subject, probe, inContainer }) => {
        subject.stacks = [stack];
        await inContainer(
          name,
          `import{rename}from'node:fs/promises';await rename(${JSON.stringify(binary)},${JSON.stringify(`${binary}.health-disabled`)})`,
        );
        return gap(await probe(subject), "system-ready", "tool-unavailable");
      });
    }
    await scenario("compiler-exists-but-fails", async ({ name, subject, probe, inContainer }) => {
      subject.stacks = ["cpp"];
      await inContainer(
        name,
        `import{rename,writeFile,chmod}from'node:fs/promises';
        await rename('/usr/bin/c++','/usr/bin/c++.health-real');
        await writeFile('/usr/bin/c++','#!/bin/sh\\nif [ "$1" = "--version" ]; then exec /usr/bin/c++.health-real --version; fi\\nexit 1\\n');
        await chmod('/usr/bin/c++',0o755);`,
      );
      return gap(await probe(subject), "system-ready", "toolchain-failed");
    });
    await scenario("stale-task-residue", async ({ name, subject, probe, inContainer }) => {
      await inContainer(
        name,
        `import{mkdir,writeFile}from'node:fs/promises';
        await mkdir('/home/agent/tmp/ended');
        await writeFile('/home/agent/tasks/ended.json',JSON.stringify({
          id:'ended',state:'finished',startedAt:Date.now()-200000,finishedAt:Date.now()-100000,
          temporaryDirectory:'/home/agent/tmp/ended'}));`,
        "agent",
      );
      subject.policy = { retentionSeconds: 1 };
      return gap(await probe(subject), "development-ready", "task-residue");
    });
    await scenario("orphaned-task", async ({ name, subject, probe, inContainer }) => {
      await inContainer(
        name,
        `import{writeFile}from'node:fs/promises';
        await writeFile('/home/agent/tasks/orphan.json',JSON.stringify({
          id:'orphan',state:'active',pid:2147483647,startedAt:Date.now()-1000}));`,
        "agent",
      );
      return gap(await probe(subject), "development-ready", "task-orphaned");
    });
    await scenario("task-deadline-gap", async ({ name, subject, probe, inContainer }) => {
      await inContainer(
        name,
        `import{writeFile}from'node:fs/promises';
        await writeFile('/home/agent/tasks/overdue.json',JSON.stringify({
          id:'overdue',state:'active',pid:1,startedAt:Date.now()-10000,deadlineAt:Date.now()-1000}));`,
        "agent",
      );
      return gap(await probe(subject), "development-ready", "task-overdue");
    });
    await scenario(
      "finished-task-process-leftover",
      async ({ name, subject, probe, inContainer }) => {
        await inContainer(
          name,
          `import{writeFile}from'node:fs/promises';
        await writeFile('/home/agent/tasks/leftover.json',JSON.stringify({
          id:'leftover',state:'finished',pid:1,startedAt:Date.now()-10000,finishedAt:Date.now()-1000}));`,
          "agent",
        );
        return gap(await probe(subject), "development-ready", "task-process-leftover");
      },
    );
    await scenario(
      "active-work-and-uncommitted-data-protected",
      async ({ name, subject, samples, probe, inContainer }) => {
        await inContainer(
          name,
          `import{writeFile}from'node:fs/promises';import{execFileSync}from'node:child_process';
        execFileSync('git',['init','/home/agent/work/project']);
        await writeFile('/home/agent/work/project/work.txt','uncommitted work\\n');
        await writeFile('/home/agent/unknown-file','keep\\n');
        await writeFile('/home/agent/tasks/active.json',JSON.stringify({
          id:'active',state:'active',pid:1,startedAt:Date.now()-86400000}));`,
          "agent",
        );
        subject.history = await samples(subject);
        const passed = healthy(await probe(subject));
        await inContainer(
          name,
          `import{readFile,readdir}from'node:fs/promises';
        if(await readFile('/home/agent/work/project/work.txt','utf8')!=='uncommitted work\\n')throw Error('work changed');
        if(await readFile('/home/agent/unknown-file','utf8')!=='keep\\n')throw Error('unknown file changed');
        process.kill(1,0);
        if((await readdir('/home/agent/tmp')).length)throw Error('scratch leaked');`,
          "agent",
        );
        return passed;
      },
    );
    await scenario("foreign-history-gap", async ({ subject, samples, probe }) => {
      subject.history = (await samples(subject)).map((entry) => ({
        ...entry,
        hostname: "other-device",
      }));
      return gap(await probe(subject), "orderly", "history-invalid");
    });
    await scenario("stale-history-gap", async ({ subject, samples, probe }) => {
      subject.history = (await samples(subject)).map((entry) => ({
        ...entry,
        measuredAt: entry.measuredAt - 600000,
      }));
      return gap(await probe(subject), "orderly", "history-insufficient");
    });
    for (const [field, directory, expected] of [
      ["cacheBytes", "/home/agent/cache", "cache-growth-high"],
      ["logBytes", "/home/agent/logs", "log-growth-high"],
    ]) {
      await scenario(
        `${field}-growth-and-recovery`,
        async ({ name, subject, direct, probe, samples, inContainer }) => {
          subject.history = [];
          for (let index = 0; index < 3; index++) {
            await inContainer(
              name,
              `import{writeFile}from'node:fs/promises';await writeFile('${directory}/growth',Buffer.alloc(${(index + 1) * 4096}))`,
              "agent",
            );
            const sample = await direct("sample", subject);
            assert.equal(sample.status, 200, JSON.stringify(sample));
            subject.history.push(sample.payload);
            if (index < 2) await pause(650);
          }
          subject.policy = { maxCacheGrowthBytesPerSecond: 1, maxLogGrowthBytesPerSecond: 1 };
          const failed = gap(await probe(subject), "orderly", expected);
          await inContainer(
            name,
            `import{unlink}from'node:fs/promises';await unlink('${directory}/growth')`,
            "agent",
          );
          subject.history = await samples(subject);
          return { failed, recovered: healthy(await probe(subject)) };
        },
      );
    }
    await scenario(
      "package-index-stale",
      async ({ name, subject, probe, samples, inContainer }) => {
        subject.history = await samples(subject);
        await inContainer(
          name,
          `import{readdir,utimes}from'node:fs/promises';
        for(const name of await readdir('/var/lib/apt/lists'))if(name.includes('Packages'))await utimes('/var/lib/apt/lists/'+name,1,1);`,
        );
        return gap(await probe(subject), "orderly", "package-index-stale");
      },
    );
    await scenario(
      "healthy-then-regression",
      async ({ name, subject, probe, samples, inContainer }) => {
        subject.history = await samples(subject);
        const passed = healthy(await probe(subject));
        await inContainer(
          name,
          "import{chown}from'node:fs/promises';await chown('/home/agent/work',0,0)",
        );
        return { passed, regressed: gap(await probe(subject), "initial", "directory-unavailable") };
      },
    );
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = String(error);
    failure = error;
  } finally {
    for (const name of containers) {
      try {
        await execute("docker", ["rm", "--force", name]);
      } catch (error) {
        cleanupErrors.push(String(error));
      }
    }
    if (report.image) {
      try {
        await execute("docker", ["image", "rm", tag]);
      } catch (error) {
        cleanupErrors.push(String(error));
      }
    }
    await rm(scratch, { recursive: true, force: true });
    report.cleaned = cleanupErrors.length === 0;
    report.finishedAt = new Date().toISOString();
    if (cleanupErrors.length) {
      report.cleanupErrors = cleanupErrors;
      report.passed = false;
    }
    if (reportPath) {
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  if (failure || cleanupErrors.length)
    throw new AggregateError(
      [...(failure ? [failure] : []), ...cleanupErrors.map((message) => new Error(message))],
      "Docker development health verification failed",
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && !(args.length === 2 && args[0] === "--report"))
    throw new Error("Usage: node scripts/verify-development-health.mjs [--report <path>]");
  await verify(args.length ? resolve(args[1]) : undefined);
}
