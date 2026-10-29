import assert from "node:assert/strict";
import cp, { type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CheckKernel,
  closePrivateFileBackend,
  connectHost,
  createPrivateDirectory,
  createPrivateFile,
  publishPrivateFile,
  readArtifact,
  serve,
} from "../dist/index.js";

async function eventually(check: () => boolean | Promise<boolean>, message: string) {
  const end = Date.now() + 20_000;
  while (!(await check())) {
    assert.ok(Date.now() < end, message);
    await new Promise((done) => setTimeout(done, 20));
  }
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("discovery tolerates an in-progress startup record without deleting unknown ownership", async () => {
  const parent = resolve(import.meta.dirname, "..", "..", "..", ".cache", "host-tests");
  await mkdir(parent, { recursive: true });
  const root = await createPrivateDirectory(parent, "discovery-");
  const kernel = await CheckKernel.create(join(root, "snapshots"));
  const token = crypto.randomUUID();
  const host = await serve(kernel, token);
  try {
    const startup = join(root, "startup.json");
    await createPrivateFile(root, "startup.json", "");
    const connection = connectHost(root).then(
      (client) => ({ client }),
      (error: unknown) => ({ error }),
    );
    await new Promise((done) => setTimeout(done, 30));
    await publishPrivateFile(
      root,
      "host.json",
      JSON.stringify({
        endpoint: host.endpoint,
        token,
        pid: process.pid,
        instance: crypto.randomUUID(),
      }),
      null,
    );
    const outcome = await connection;
    assert.ok("client" in outcome);
    assert.equal(outcome.client.address.pid, process.pid);
    assert.equal(await readFile(startup, "utf8"), "");
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("real startup and published Host crashes recover once without replaying old tasks", async (t) => {
  const parent = resolve(import.meta.dirname, "..", "..", "..", ".cache", "host-tests");
  await mkdir(parent, { recursive: true });
  const root = await createPrivateDirectory(parent, "crash-");
  const main = fileURLToPath(new URL("../dist/main.js", import.meta.url));
  const preload = join(root, "owned-processes.mjs");
  const journal = join(root, "owned-processes.jsonl");
  const pause = join(root, "pause-listen");
  const pauseEarly = join(root, "pause-before-main");
  const originalSpawn = cp.spawn;
  const hosts = new Map<ChildProcess, Promise<void>>();
  const errors = new Map<ChildProcess, string>();
  const helpers = new Set<number>();
  const claimed = new Set<ChildProcess>();
  const early = new Set<ChildProcess>();
  const pending: Promise<unknown>[] = [];
  const connect = (directory: string) => {
    const connection = connectHost(directory);
    pending.push(connection);
    return connection;
  };
  await writeFile(
    preload,
    `import cp from "node:child_process";
import http from "node:http";
import {existsSync} from "node:fs";
import {syncBuiltinESMExports} from "node:module";
const spawn=cp.spawn;
cp.spawn=(...args)=>{
  const child=spawn(...args);
  child.once("spawn",()=>process.send?.({helper:child.pid}));
  return child;
};
if(existsSync(${JSON.stringify(pause)}))
  http.Server.prototype.listen=function(){setInterval(()=>{},1000);process.send?.({claimed:true});return this};
syncBuiltinESMExports();
if(existsSync(${JSON.stringify(pauseEarly)})){
  process.send?.({early:true});await new Promise(()=>setInterval(()=>{},1000));
}`,
  );
  t.mock.method(
    cp,
    "spawn",
    (command: string, args: readonly string[] = [], options: SpawnOptions = {}) => {
      if (command !== process.execPath || args[0] !== main || !args[1]?.startsWith(root))
        return originalSpawn(command, args, options);
      if (options.detached) assert.equal(options.cwd, args[1]);
      const child = originalSpawn(command, ["--import", pathToFileURL(preload).href, ...args], {
        ...options,
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      child.stderr?.on("data", (bytes: Buffer) =>
        errors.set(child, `${errors.get(child) ?? ""}${bytes.toString("utf8")}`.slice(-8192)),
      );
      appendFileSync(
        journal,
        `${JSON.stringify({ kind: "host", pid: child.pid, directory: args[1], main, preload, startedAt: new Date().toISOString() })}\n`,
      );
      hosts.set(child, new Promise<void>((done) => child.once("close", () => done())));
      child.on("message", (message: unknown) => {
        const record = message as { helper?: number; claimed?: boolean; early?: boolean };
        if (record.claimed) claimed.add(child);
        if (record.early) early.add(child);
        if (record.helper) {
          assert.ok(Number.isSafeInteger(record.helper) && record.helper > 0);
          assert.notEqual(record.helper, process.pid);
          helpers.add(record.helper);
          appendFileSync(
            journal,
            `${JSON.stringify({ kind: "helper", pid: record.helper, parent: child.pid, startedAt: new Date().toISOString() })}\n`,
          );
        }
      });
      return child;
    },
  );
  syncBuiltinESMExports();
  try {
    const artifactDirectory = join(root, "artifact");
    await mkdir(artifactDirectory);
    await writeFile(
      join(artifactDirectory, "worker.cjs"),
      `exports.execute=async(_,context)=>new Promise(done=>{
const timer=setTimeout(()=>done({ok:true}),30000);
context.defer(()=>clearTimeout(timer));
});`,
    );
    const artifact = await readArtifact(artifactDirectory);
    for (const phase of ["early", "claimed", "published", "early", "claimed", "published"]) {
      const directory = await createPrivateDirectory(root, "host-");
      let first: ChildProcess;
      let recovering: Promise<Awaited<ReturnType<typeof connectHost>>[]> | undefined;
      if (phase === "early") {
        await writeFile(pauseEarly, "");
        const count = hosts.size;
        recovering = Promise.all(Array.from({ length: 4 }, () => connect(directory)));
        void recovering.catch(() => {});
        await eventually(() => hosts.size > count, "Discovery did not launch its owned child.");
        first = [...hosts.keys()].at(-1) as ChildProcess;
        await eventually(() => early.has(first), "Owned child did not reach pre-main phase.");
        await eventually(
          async () =>
            JSON.parse(await readFile(join(directory, "startup.json"), "utf8")).pid === first.pid,
          "Launcher failed to transfer reservation ownership to its child.",
        );
        await rm(pauseEarly);
      } else {
        const reservation = randomUUID();
        await createPrivateFile(
          directory,
          "startup.json",
          JSON.stringify({ pid: process.pid, reservation }),
        );
        if (phase === "claimed") await writeFile(pause, "");
        first = cp.spawn(process.execPath, [main, directory, reservation], {
          windowsHide: true,
          env: { ...process.env, NODE_OPTIONS: "" },
        });
      }
      let previous: Awaited<ReturnType<typeof connectHost>> | undefined;
      let oldId: string | undefined;
      if (phase === "claimed") {
        await eventually(
          () => claimed.has(first),
          "Owned startup never reached its claimed phase.",
        );
        await rm(pause);
        const startup = JSON.parse(await readFile(join(directory, "startup.json"), "utf8"));
        assert.equal(startup.pid, first.pid);
        await assert.rejects(readFile(join(directory, "host.json")), { code: "ENOENT" });
      } else if (phase === "published") {
        previous = await connectHost(directory);
        assert.equal(previous.address.pid, first.pid);
        assert.equal(new URL(previous.address.endpoint).hostname, "127.0.0.1");
        oldId = await previous.start({
          directory: artifact.directory,
          revision: artifact.revision,
          subject: {},
        });
      }
      first.ref();
      const before = hosts.size;
      first.kill("SIGKILL");
      await hosts.get(first);
      const clients = await (recovering ??
        Promise.all(Array.from({ length: 4 }, () => connect(directory))));
      if (hosts.size !== before + 1)
        t.diagnostic(
          JSON.stringify({
            phase,
            before,
            journal: await readFile(journal, "utf8"),
            processes: [...hosts.keys()].map((child) => ({
              pid: child.pid,
              exitCode: child.exitCode,
              signalCode: child.signalCode,
              error: errors.get(child),
            })),
          }),
        );
      assert.equal(hosts.size, before + 1, "Concurrent recovery must launch exactly one Host.");
      const replacement = [...hosts.keys()].at(-1);
      assert.ok(replacement);
      for (const client of clients) {
        assert.equal(client.address.pid, replacement.pid);
        assert.equal(client.address.instance, clients[0]?.address.instance);
        if (oldId) await assert.rejects(client.sample(oldId), { status: 404 });
      }
      if (previous) assert.notEqual(clients[0]?.address.instance, previous.address.instance);
      replacement.ref();
      replacement.kill("SIGTERM");
      await hosts.get(replacement);
      t.diagnostic(`Recovered ${phase} crash with four concurrent callers and one replacement.`);
    }
  } finally {
    await Promise.allSettled(pending);
    t.mock.restoreAll();
    syncBuiltinESMExports();
    for (const [child, closed] of hosts) {
      child.ref();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed;
    }
    await closePrivateFileBackend();
    try {
      await eventually(
        () => [...helpers].every((pid) => !alive(pid)),
        "An owned Host permission helper did not exit on pipe closure.",
      );
    } finally {
      for (const pid of helpers) if (alive(pid)) process.kill(pid, "SIGKILL");
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});
