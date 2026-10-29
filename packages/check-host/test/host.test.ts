import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Effect, SubscriptionRef, watchSnapshot } from "@potential-guide/effects";
import {
  CheckClient,
  CheckKernel,
  type CheckState,
  readArtifact,
  serve,
  terminal,
} from "../dist/index.js";

const source = `
let count=0;
exports.execute=async (subject,context)=>{
  count++;
  if(subject.fail)throw new Error("business invocation fault");
  if(subject.wait)await new Promise(resolve=>{
    const timer=setTimeout(resolve,subject.wait);
    const abort=()=>{clearTimeout(timer);resolve()};
    context.signal.addEventListener("abort",abort,{once:true});
    context.defer(()=>{clearTimeout(timer);context.signal.removeEventListener("abort",abort)});
  });
  if(subject.dirty)context.defer(()=>{throw new Error("cleanup fault")});
  return {ok:!subject.notPassed,count,subject:subject.value??null};
};`;
async function fixture(options: Parameters<typeof CheckKernel.create>[1] = {}) {
  const scratch = resolve(".cache", "check-host-tests");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "case-"));
  const artifact = join(directory, "artifact");
  await mkdir(artifact);
  await writeFile(join(artifact, "worker.cjs"), source);
  const revision = (await readArtifact(artifact)).revision;
  const kernel = await CheckKernel.create(join(directory, "snapshots"), options);
  return {
    directory: artifact,
    revision,
    kernel,
    close: async () => {
      await kernel.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function completed(kernel: CheckKernel, id: string): Promise<CheckState> {
  const execution = kernel.observe(id);
  return new Promise((resolve) => {
    const lifetime = new AbortController();
    watchSnapshot(
      execution.state,
      (state) => {
        if (terminal(state)) {
          lifetime.abort();
          resolve(state);
        }
      },
      lifetime.signal,
    );
  });
}
test("HTTP-free execution has one Behavior, reused threads, authentic business results", async () => {
  const f = await fixture();
  try {
    const request = {
      checkId: "one",
      directory: f.directory,
      revision: f.revision,
      subject: { notPassed: true },
    };
    const first = await f.kernel.executeCheck(request);
    assert.equal(first, await f.kernel.executeCheck(request));
    const watchers = [completed(f.kernel, "one"), completed(f.kernel, "one")];
    const state = await watchers[0];
    assert.deepEqual(state, await watchers[1]);
    assert.equal(state?.state, "Completed");
    assert.equal(Effect.runSync(SubscriptionRef.get(first.state)), state);
    for (let n = 0; n < 12; n++) {
      const id = `next-${n}`;
      await f.kernel.executeCheck({ ...request, checkId: id, subject: { value: n } });
      const result = await completed(f.kernel, id);
      assert.equal(result.state, "Completed");
      if (result.state === "Completed")
        assert.equal((result.result as { count: number }).count, n + 2);
    }
    assert.equal(f.kernel.diagnostics().initializations, 1);
    assert.equal(f.kernel.diagnostics().executions, 13);
    await assert.rejects(f.kernel.executeCheck({ ...request, subject: {} }), /conflict/);
  } finally {
    await f.close();
  }
});
test("worker initialization has its own budget independent of execution cleanup", async () => {
  const f = await fixture({ cleanupMs: 50, initializationMs: 5000 });
  try {
    await writeFile(
      join(f.directory, "worker.cjs"),
      `exports.initialize=async()=>new Promise(done=>setTimeout(done,150));
exports.execute=async()=>({ok:true});`,
    );
    const revision = (await readArtifact(f.directory)).revision;
    await f.kernel.executeCheck({
      checkId: "slow-initialize",
      directory: f.directory,
      revision,
      subject: {},
    });
    assert.equal((await completed(f.kernel, "slow-initialize")).state, "Completed");
    assert.equal(f.kernel.diagnostics().initializations, 1);
  } finally {
    await f.close();
  }
});
test("cold initialization and shutdown during initialization retain bounded, confirmed ownership", async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.directory, "worker.cjs"),
      `exports.initialize=async()=>new Promise(done=>setTimeout(done,100));
exports.execute=async()=>({ok:true});`,
    );
    const revision = (await readArtifact(f.directory)).revision;
    await f.kernel.executeCheck({
      checkId: "starting",
      directory: f.directory,
      revision,
      subject: {},
    });

    assert.equal(f.kernel.sample("starting").state, "Queued");
    assert.equal(f.kernel.diagnostics().initializations, 1);
    await f.kernel.close();
    assert.equal(f.kernel.diagnostics().workers, 0);
    assert.equal(f.kernel.diagnostics().queue, 0);
    assert.equal(f.kernel.diagnostics().ownedProcesses, 0);
  } finally {
    await f.close();
  }
});
test("fresh real-package snapshots can shut down during startup without native handle failures", async () => {
  const artifact = await readArtifact(
    resolve(
      import.meta.dirname,
      "..",
      "..",
      "objective-package-standard",
      "dist",
      "package",
      "checks",
      "structure",
    ),
  );
  for (let index = 0; index < 8; index++) {
    const f = await fixture();
    try {
      await f.kernel.executeCheck({
        checkId: `starting-real-${index}`,
        directory: artifact.directory,
        revision: artifact.revision,
        subject: {},
      });
      assert.equal(f.kernel.diagnostics().initializations, 1);
      const started = performance.now();
      await f.kernel.close();
      assert.equal(f.kernel.diagnostics().workers, 0);
      assert.equal(f.kernel.diagnostics().queue, 0);
      assert.equal(f.kernel.diagnostics().ownedProcesses, 0);
      const shutdownMs = performance.now() - started;
      assert.ok(
        shutdownMs < f.kernel.limits.cleanupMs,
        `Shutdown exceeded cleanup budget: ${shutdownMs}ms`,
      );
    } finally {
      await f.close();
    }
  }
});
test("real four-route HTTP observation disconnect does not cancel; collection omits secrets", async () => {
  const f = await fixture();
  const token = randomUUID();
  const host = await serve(f.kernel, token);
  try {
    const client = new CheckClient({
      endpoint: host.endpoint,
      token,
      pid: process.pid,
      instance: randomUUID(),
    });
    const id = await client.start({
      directory: f.directory,
      revision: f.revision,
      subject: { wait: 200, value: "PRIVATE" },
    });
    const headers = { authorization: `Bearer ${token}` };
    const active = await (await fetch(`${host.endpoint}/checks`, { headers })).json();
    assert.ok(!JSON.stringify(active).includes("PRIVATE"));
    const stream = await fetch(`${host.endpoint}/checks/${id}`, {
      headers: { ...headers, accept: "application/x-ndjson" },
    });
    await stream.body?.cancel();
    assert.equal((await client.wait(id)).state, "Completed");
    assert.equal(f.kernel.diagnostics().executions, 1);
    assert.deepEqual(await (await fetch(`${host.endpoint}/checks`, { headers })).json(), []);
    assert.equal((await fetch(`${host.endpoint}/checks`)).status, 401);
    assert.equal(
      (
        await fetch(`${host.endpoint}/checks`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: '{"root":"/"}',
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(`${host.endpoint}/register`, { method: "POST", headers })).status,
      404,
    );
  } finally {
    await host.close();
    await f.close();
  }
});
test("cancellation, queue limits, full resource revisions, expiry and unhealthy isolation", async () => {
  const f = await fixture({ workers: 1, queue: 1, retentionMs: 60, retireAfter: 4 });
  try {
    const request = { directory: f.directory, revision: f.revision, subject: { wait: 1000 } };
    await f.kernel.executeCheck({ ...request, checkId: "a" });
    while (f.kernel.sample("a").state === "Queued")
      await new Promise((resolve) => setTimeout(resolve, 5));
    await f.kernel.executeCheck({ ...request, checkId: "b" });
    await assert.rejects(f.kernel.executeCheck({ ...request, checkId: "c" }), /capacity/);
    await writeFile(join(f.directory, "resource.txt"), "changed");
    const changed = (await readArtifact(f.directory)).revision;
    assert.notEqual(changed, f.revision);
    f.kernel.cancel("b");
    await assert.rejects(
      f.kernel.executeCheck({ ...request, checkId: "d", revision: changed }),
      /busy/,
    );
    f.kernel.cancel("a");
    assert.equal((await completed(f.kernel, "a")).state, "Cancelled");
    await f.kernel.executeCheck({
      ...request,
      revision: changed,
      subject: { dirty: true },
      checkId: "dirty",
    });
    assert.equal((await completed(f.kernel, "dirty")).state, "Failed");
    await f.kernel.executeCheck({ ...request, revision: changed, subject: {}, checkId: "clean" });
    assert.equal((await completed(f.kernel, "clean")).state, "Completed");
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.throws(() => f.kernel.observe("clean"), /expired/);
    assert.equal(f.kernel.diagnostics().ownedProcesses, 0);
    assert.ok(f.kernel.diagnostics().peakWorkers <= 1);
  } finally {
    await f.close();
  }
});
