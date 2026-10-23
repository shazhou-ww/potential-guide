import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  if(subject.wait)await new Promise(done=>{
    const timer=setTimeout(done,subject.wait);
    const abort=()=>{clearTimeout(timer);done()};
    context.signal.addEventListener("abort",abort,{once:true});
    context.defer(()=>{clearTimeout(timer);context.signal.removeEventListener("abort",abort)});
    if(context.signal.aborted)abort();
  });
  if(subject.flood)for(let n=0;n<32;n++)context.progress({n,text:"x".repeat(32768)});
  return {calls,value:subject.value??null};
};`;

test("worker runtime excludes caller loader flags and rejects unbundled dependencies", async () => {
  const f = await fixture(`exports.execute=(subject)=>{
    if(subject.import)require("not-a-bundled-dependency");
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
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
    await f.close();
  }
});

test("HTTP snapshots and terminal resubscriptions project the same kernel execution; observer capacity recovers", async () => {
  const f = await fixture(basic, { observers: 1, retentionMs: 3000 });
  const host = await serve(f.kernel, "boundaries");
  const headers = { authorization: "Bearer boundaries" };
  try {
    const client = new CheckClient({
      endpoint: host.endpoint,
      token: "boundaries",
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
  const host = await serve(f.kernel, "recovery");
  try {
    const client = new CheckClient({
      endpoint: host.endpoint,
      token: "recovery",
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
      subject: { wait: 200 },
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
    await finished(f.kernel, "old");
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

test("deadline cancellation and retirement/prewarm remain bounded across mixed outcomes", async () => {
  const f = await fixture(basic, { workers: 2, retireAfter: 3, deadlineMs: 250, cleanupMs: 1000 });
  try {
    await f.start("deadline", { wait: 5000 });
    assert.equal((await finished(f.kernel, "deadline")).state, "Cancelled");
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
  const options={stdio:"ignore",detached:process.platform!=="win32"};
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
    for (const kind of ["execFile", "promise", "fork"]) {
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
