import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  CheckClient,
  CheckKernel,
  type CheckState,
  readArtifact,
  serve,
  terminal,
} from "../dist/index.js";

async function fixture(source: string, limits: Parameters<typeof CheckKernel.create>[1] = {}) {
  const parent = resolve(".cache", "check-host-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "boundaries-"));
  const directory = join(root, "artifact");
  await mkdir(directory);
  await writeFile(join(directory, "worker.cjs"), source);
  const kernel = await CheckKernel.create(join(root, "snapshots"), limits);
  return {
    root,
    directory,
    kernel,
    async start(checkId: string, subject: Record<string, string | number | boolean> = {}) {
      const artifact = await readArtifact(directory);
      return kernel.executeCheck({ checkId, directory, revision: artifact.revision, subject });
    },
    async close() {
      await kernel.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
async function finished(kernel: CheckKernel, id: string): Promise<CheckState> {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    const state = kernel.sample(id);
    if (terminal(state)) return state;
    await new Promise((done) => setTimeout(done, 5));
  }
  throw new Error(`Execution did not finish: ${id}`);
}
const basic = `
let calls=0;
exports.execute=async(subject,context)=>{
  calls++;
  if(subject.wait || subject.hold)await new Promise(done=>{
    const timer=subject.hold?undefined:setTimeout(done,subject.wait);
    const abort=()=>{clearTimeout(timer);done()};
    context.signal.addEventListener("abort",abort,{once:true});
    context.defer(()=>{clearTimeout(timer);context.signal.removeEventListener("abort",abort)});
    if(context.signal.aborted)abort();
  });
  if(subject.flood)for(let n=0;n<32;n++)context.progress({n,text:"x".repeat(32768)});
  return {calls,value:subject.value??null};
};`;

test("verified in-memory CommonJS retains module metadata, top-level exports and shebang semantics", async () => {
  const f = await fixture(
    "\ufeff#!/usr/bin/env node\nthis.execute=async()=>({same:module.filename===__filename,directory:__dirname,hasRequire:typeof module.require});",
  );
  try {
    await f.start("commonjs");
    const result = await finished(f.kernel, "commonjs");
    assert.equal(result.state, "Completed");
    if (result.state === "Completed") {
      const value = result.result as { same: boolean; directory: string; hasRequire: string };
      assert.equal(value.same, true);
      assert.equal(value.hasRequire, "function");
      assert.ok(value.directory.startsWith(join(f.root, "snapshots")));
    }
  } finally {
    await f.close();
  }
});

test("verified Wasm resources execute while untrackable synchronous subprocess APIs fail closed", async () => {
  const f = await fixture(`exports.execute=async(subject)=>{
    if(subject.sync)require("node:child_process").execFileSync(process.execPath,["-e","throw Error('MUST NOT RUN')"]);
    const bytes=await require("node:fs/promises").readFile(require("node:path").join(__dirname,"resources","value.wasm"));
    const {instance}=await WebAssembly.instantiate(bytes);
    return {value:instance.exports.value()};
  };`);
  try {
    await mkdir(join(f.directory, "resources"));
    await writeFile(
      join(f.directory, "resources", "value.wasm"),
      Buffer.from([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 9, 1, 5, 118, 97, 108,
        117, 101, 0, 0, 10, 6, 1, 4, 0, 65, 42, 11,
      ]),
    );
    await f.start("wasm");
    const result = await finished(f.kernel, "wasm");
    assert.equal(result.state, "Completed");
    if (result.state === "Completed") assert.deepEqual(result.result, { value: 42 });
    await f.start("sync", { sync: true });
    const rejected = await finished(f.kernel, "sync");
    assert.equal(rejected.state, "Failed");
    if (rejected.state === "Failed")
      assert.match(rejected.error, /request-owned asynchronous subprocesses/);
    assert.equal(f.kernel.diagnostics().ownedProcesses, 0);
  } finally {
    await f.close();
  }
});

test("POSIX executable resources retain owner-only execution and affect complete artifact identity", {
  skip: process.platform === "win32" ? "Actual POSIX executable permissions required" : false,
}, async () => {
  const f = await fixture(`exports.execute=async()=>({output:await new Promise((done,fail)=>
    require("node:child_process").execFile(require("node:path").join(__dirname,"resources","tool"),[],
      (error,stdout)=>error?fail(error):done(stdout)))});`);
  try {
    await mkdir(join(f.directory, "resources"));
    const resource = join(f.directory, "resources", "tool");
    await writeFile(resource, "#!/bin/sh\nprintf ready\n", { mode: 0o755 });
    const before = await readArtifact(f.directory);
    await f.start("executable");
    const result = await finished(f.kernel, "executable");
    assert.equal(result.state, "Completed");
    if (result.state === "Completed") assert.deepEqual(result.result, { output: "ready" });
    await chmod(resource, 0o600);
    assert.notEqual((await readArtifact(f.directory)).revision, before.revision);
  } finally {
    await f.close();
  }
});

test("worker runtime excludes caller loader flags and rejects unbundled dependencies", async () => {
  const f = await fixture(`exports.execute=(subject)=>{
    if(subject.import)require("not-a-bundled-dependency");
    if(subject.dynamic)return import("@potential-guide/effects");
    return {execArgv:process.execArgv,nodeOptions:process.env.NODE_OPTIONS};
  };`);
  const previous = process.env.NODE_OPTIONS;
  try {
    process.env.NODE_OPTIONS = "--trace-warnings";
    await f.start("flags");
    const first = await finished(f.kernel, "flags");
    assert.equal(first.state, "Completed");
    if (first.state === "Completed")
      assert.deepEqual(first.result, { execArgv: [], nodeOptions: "" });
    await f.start("unbundled", { import: true });
    const second = await finished(f.kernel, "unbundled");
    assert.equal(second.state, "Failed");
    if (second.state === "Failed") assert.match(second.error, /dependencies must be bundled/);
    await f.start("dynamic", { dynamic: true });
    const dynamic = await finished(f.kernel, "dynamic");
    assert.equal(dynamic.state, "Failed");
    if (dynamic.state === "Failed") assert.match(dynamic.error, /dynamic import|module/i);
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
    await f.close();
  }
});

test("HTTP snapshots and terminal resubscriptions project the same kernel execution; observer capacity recovers", async () => {
  const f = await fixture(basic, { observers: 1, retentionMs: 3000 });
  const token = randomUUID();
  const host = await serve(f.kernel, token);
  const headers = { authorization: `Bearer ${token}` };
  try {
    const client = new CheckClient({
      endpoint: host.endpoint,
      token,
      pid: process.pid,
      instance: randomUUID(),
    });
    const artifact = await readArtifact(f.directory);
    const id = await client.start({
      directory: artifact.directory,
      revision: artifact.revision,
      subject: { wait: 100, value: "one" },
    });
    const stream = await fetch(`${host.endpoint}/checks/${id}`, {
      headers: { ...headers, accept: "application/x-ndjson" },
    });
    const reader = stream.body?.getReader();
    assert.ok(reader);
    assert.equal((await reader.read()).done, false);
    assert.equal(
      (
        await fetch(`${host.endpoint}/checks`, {
          headers: { ...headers, accept: "application/x-ndjson" },
        })
      ).status,
      429,
    );
    await reader.cancel();
    await new Promise((done) => setTimeout(done, 30));
    const result = await client.wait(id);
    assert.deepEqual(result, f.kernel.sample(id));
    assert.deepEqual(await client.wait(id), result);
    assert.deepEqual(await client.sample(id), result);
    assert.equal(f.kernel.diagnostics().executions, 1);
    assert.deepEqual(await (await fetch(`${host.endpoint}/checks`, { headers })).json(), []);
    await client.cancel(id);
    assert.deepEqual(f.kernel.sample(id), result);
    const floodId = await client.start({
      directory: artifact.directory,
      revision: artifact.revision,
      subject: { wait: 100, flood: true },
    });
    const slow = await fetch(`${host.endpoint}/checks/${floodId}`, {
      headers: { ...headers, accept: "application/x-ndjson" },
    });
    assert.equal((await finished(f.kernel, floodId)).state, "Completed");
    await slow.body?.cancel().catch(() => {});
    assert.equal(f.kernel.diagnostics().executions, 2);
    const largeId = await client.start({
      directory: artifact.directory,
      revision: artifact.revision,
      subject: { value: "large-result-".repeat(16_384) },
    });
    assert.deepEqual(await client.wait(largeId), f.kernel.sample(largeId));
  } finally {
    await host.close();
    await f.close();
  }
});

test("lost start responses recover the same client ID without repeating work", async (t) => {
  const f = await fixture(basic);
  const token = randomUUID();
  const host = await serve(f.kernel, token);
  try {
    const client = new CheckClient({
      endpoint: host.endpoint,
      token,
      pid: process.pid,
      instance: randomUUID(),
    });
    const original = globalThis.fetch;
    let lost = 0;
    t.mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) => {
      const response = await original(...args);
      if (
        args[1]?.method === "POST" &&
        String(args[0]) === `${host.endpoint}/checks` &&
        lost++ === 0
      ) {
        await response.body?.cancel();
        throw new TypeError("Simulated loss after server acceptance.");
      }
      return response;
    });
    const artifact = await readArtifact(f.directory);
    const result = await client.execute(
      {
        directory: artifact.directory,
        revision: artifact.revision,
        subject: {},
      },
      AbortSignal.timeout(5000),
    );
    assert.equal(result.state, "Completed");
    assert.equal(f.kernel.diagnostics().executions, 1);
  } finally {
    t.mock.restoreAll();
    await host.close();
    await f.close();
  }
});

test("resource bytes, links, canonical paths and drain-before-revision-switch are enforced", async () => {
  const f = await fixture(basic, { workers: 1, retireAfter: 2 });
  try {
    await writeFile(join(f.directory, "data.txt"), "one");
    const first = await readArtifact(f.directory);
    await f.kernel.executeCheck({
      checkId: "old",
      directory: join(f.directory, "."),
      revision: first.revision,
      subject: { hold: true },
    });
    await writeFile(join(f.directory, "data.txt"), "two");
    const second = await readArtifact(f.directory);
    assert.notEqual(first.revision, second.revision);
    await assert.rejects(
      f.kernel.executeCheck({
        checkId: "busy",
        directory: f.directory,
        revision: second.revision,
        subject: {},
      }),
      /busy/,
    );
    await assert.rejects(
      f.kernel.executeCheck({
        checkId: "forged",
        directory: f.directory,
        revision: first.revision,
        subject: {},
      }),
      /mismatch/,
    );
    f.kernel.cancel("old");
    assert.equal((await finished(f.kernel, "old")).state, "Cancelled");
    await f.start("updated", { value: "new" });
    const updated = await finished(f.kernel, "updated");
    assert.equal(updated.state, "Completed");
    if (updated.state === "Completed") assert.equal((updated.result as { calls: number }).calls, 1);
    await link(join(f.directory, "data.txt"), join(f.root, "owned-link.txt"));
    await assert.rejects(readArtifact(f.directory), /hard-link/);
  } finally {
    await f.close();
  }
});

test("deadline cancellation remains bounded", async () => {
  const f = await fixture(basic, { deadlineMs: 250, cleanupMs: 1000 });
  try {
    await f.start("deadline", { wait: 5000 });
    assert.equal((await finished(f.kernel, "deadline")).state, "Cancelled");
    assert.equal(f.kernel.diagnostics().ownedProcesses, 0);
  } finally {
    await f.close();
  }
});

test("retirement/prewarm remain bounded across repeated successful executions", async () => {
  const f = await fixture(basic, { workers: 2, retireAfter: 3 });
  try {
    for (let n = 0; n < 12; n++) {
      await f.start(`mixed-${n}`, { value: n });
      assert.equal((await finished(f.kernel, `mixed-${n}`)).state, "Completed");
      assert.ok(f.kernel.diagnostics().workers <= 2);
    }
    const stats = f.kernel.diagnostics();
    assert.ok(stats.retirements >= 3);
    assert.ok(stats.initializations < stats.executions);
    assert.ok(stats.peakWorkers <= 2);
    assert.equal(stats.ownedProcesses, 0);
    assert.ok(
      f.kernel.workerSamples.every(
        ({ resources }) => resources.timers === 0 && resources.processes === 0,
      ),
    );
  } finally {
    await f.close();
  }
});

test("execFile, promisified execFile and fork children are owned and cleanup failures cannot pass", async () => {
  const source = `
const cp=require("node:child_process");
const {promisify}=require("node:util");
const {writeFileSync}=require("node:fs");
const {join}=require("node:path");
exports.execute=async(subject)=>{
  const options={stdio:"ignore",detached:process.platform!=="win32" && subject.kind!=="attached"};
  const pending=subject.kind==="fork"
    ? cp.fork(join(__dirname,"child.cjs"),[],{...options,stdio:["ignore","ignore","ignore","ipc"]})
    : subject.kind==="promise"
      ? promisify(cp.execFile)(process.execPath,["-e","setInterval(()=>{},1000)"],options)
      : cp.execFile(process.execPath,["-e","setInterval(()=>{},1000)"],options);
  const child=pending.child??pending;
  if(pending.child)pending.catch(()=>{});
  writeFileSync(subject.pidFile,String(child.pid));
  return {ok:true};
};`;
  const f = await fixture(source, { workers: 1, cleanupMs: 1000 });
  const owned = new Set<number>();
  try {
    await writeFile(join(f.directory, "child.cjs"), "setInterval(()=>{},1000);");
    for (const kind of ["execFile", "promise", "fork", "attached"]) {
      const pidFile = join(f.root, `${kind}.pid`);
      await f.start(kind, { kind, pidFile });
      const state = await finished(f.kernel, kind);
      const pid = Number(await readFile(pidFile, "utf8"));
      assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid);
      owned.add(pid);
      assert.equal(state.state, "Failed");
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      owned.delete(pid);
      assert.equal(f.kernel.diagnostics().ownedProcesses, 0);
    }
  } finally {
    for (const pid of owned) {
      if (process.platform === "win32")
        await promisify(execFile)("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
        }).catch(() => {});
      else {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {}
      }
    }
    await f.close();
  }
});
