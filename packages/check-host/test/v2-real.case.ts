import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { inspectCheckArtifact } from "@potential-guide/check-artifacts";
import { packCheckArtifact } from "@potential-guide/check-artifacts/build";
import {
  ArtifactManager,
  CheckClient,
  CheckKernel,
  TaskScheduler,
  TaskProtocolError,
  closePrivateFileBackend,
  serve,
  v2Limits,
  type CheckTask,
  type CheckTaskSnapshot,
} from "../dist/index.js";

const directory = process.env.V2_TEST_DIRECTORY;
if (!directory) throw new Error("Trusted HTTPS test must run through v2-real.test.ts.");
const source = (version: string) => `
const fs=require("node:fs");
let count=0;
exports.execute=async(subject,context)=>{
  count++;
  if(subject.process)require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore",detached:process.platform!=="win32"});
  if(subject.spin)while(true){}
  if(subject.wait)await new Promise(resolve=>{
    const timer=setTimeout(resolve,subject.wait);
    const abort=()=>{clearTimeout(timer);resolve()};
    context.signal.addEventListener("abort",abort,{once:true});
    context.defer(()=>{clearTimeout(timer);context.signal.removeEventListener("abort",abort)});
  });
  if(subject.cleanup)context.defer(()=>fs.writeFileSync(subject.cleanup,"clean"));
  if(subject.dirty)context.defer(()=>{throw Error("dirty")});
  if(subject.throw)throw Error("private diagnostic secret");
  return {ok:!subject.fail,version:${JSON.stringify(version)},count,...(subject.bytes?{blob:"x".repeat(subject.bytes)}:{})};
}`;
async function build(version: string) {
  const root = join(directory ?? "", version);
  await mkdir(join(root, "references"), { recursive: true });
  await writeFile(join(root, "worker.cjs"), source(version));
  await writeFile(join(root, "references", "check.md"), `# ${version}\n`);
  await writeFile(
    join(root, "check.json"),
    JSON.stringify({
      format: "pguide-check-v1",
      id: "fixture",
      version,
      worker: "worker.cjs",
      protocol: "pguide-check-host-v1",
      subjectSchema: { type: "object" },
      resultSchema: { type: "object", required: ["ok", "version", "count"] },
      resources: [],
      references: { check: "references/check.md", problems: {} },
    }),
  );
  const artifact = await inspectCheckArtifact(root);
  const archive = join(directory ?? "", `${version}.tgz`);
  await packCheckArtifact(root, archive);
  return { digest: artifact.digest, bytes: await readFile(archive) };
}
async function waitState(task: CheckTask, state: string) {
  const deadline = performance.now() + 5000;
  for (;;) {
    const value = await task.snapshot();
    if (value.state === state) return value;
    if (performance.now() >= deadline)
      throw new Error(`Waiting for ${state}, got ${JSON.stringify(value)}`);
    await delay(10);
  }
}
async function waitUntil(check: () => boolean | Promise<boolean>) {
  const deadline = performance.now() + 5000;
  while (!(await check())) {
    if (performance.now() >= deadline) throw new Error("Real resource cleanup did not complete.");
    await delay(10);
  }
}
test("HTTPS source versions and evidence, HTTP boundary, SDK observers and worker lifecycle", {
  timeout: 90_000,
}, async () => {
  const v2 = await build("V2"),
    v3 = await build("V3");
  let current = v2.bytes;
  let downloads = 0;
  const https = createServer(
    {
      cert: await readFile(join(directory, "cert.pem")),
      key: await readFile(join(directory, "key.pem")),
    },
    (req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "/latest?credential=redacted" });
        res.end();
      } else if (req.url === "/loop") {
        res.writeHead(302, { location: "/loop" });
        res.end();
      } else if (req.url === "/downgrade") {
        res.writeHead(302, { location: "http://127.0.0.1/unsafe" });
        res.end();
      } else if (req.url === "/oversize") {
        res.writeHead(200, { "content-length": String(100 * 1024 * 1024) });
        res.end();
      } else if (req.url === "/invalid") {
        res.end("not a tgz");
      } else {
        downloads++;
        res.end(current);
      }
    },
  );
  await new Promise<void>((resolve) => https.listen(0, "127.0.0.1", resolve));
  const addr = https.address();
  assert.ok(addr && typeof addr !== "string");
  const origin = `https://127.0.0.1:${addr.port}`;
  const limits = { ...v2Limits, timeoutMs: 5000, maxTimeoutMs: 10_000 };
  const manager = new ArtifactManager(join(directory, "cache"), [origin], limits);
  assert.throws(
    () =>
      new ArtifactManager(join(directory, "invalid-capacity"), [origin], {
        ...limits,
        artifacts: 64,
      }),
    /1\.\.32/,
  );
  const kernel = await CheckKernel.create(join(directory, "snapshots"), {
    deadlineMs: 1000,
    cleanupMs: 300,
    workers: 2,
  });
  const scheduler = new TaskScheduler(manager, kernel, limits);
  const host = await serve(kernel, "fixture-token", scheduler);
  const client = new CheckClient({
    endpoint: host.endpoint,
    token: "fixture-token",
    pid: process.pid,
    instance: scheduler.instance,
  });
  const task = (
    subject: Record<string, string | number | boolean> = {},
    options: {
      digest?: string;
      timeoutMs?: number;
      freshness?: "started-after-request" | "completed-after-request";
    } = {},
  ) =>
    client.check({
      check: { url: `${origin}/latest`, ...(options.digest ? { digest: options.digest } : {}) },
      subject,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.freshness ? { freshness: options.freshness } : {}),
    });
  const raw = async (path: string, method = "GET", value?: unknown) =>
    fetch(`${host.endpoint}${path}`, {
      method,
      headers: { authorization: "Bearer fixture-token", "content-type": "application/json" },
      ...(value ? { body: JSON.stringify(value) } : {}),
    });
  try {
    const first = await task({ wait: 450, fail: true });
    await waitState(first, "running");
    const managedId = (await first.snapshot()).executionId;
    assert.ok(managedId);
    assert.equal((await raw(`/checks/${managedId}`)).status, 404);
    assert.equal((await raw(`/checks/${managedId}/cancel`, "POST")).status, 404);
    assert.ok(!JSON.stringify(await (await raw("/checks")).json()).includes(managedId));
    current = v3.bytes;
    const second = await task({ fail: true });
    const [old, latest] = await Promise.all([first.result(), second.result()]);
    assert.equal(old.artifact?.digest, v2.digest);
    assert.equal(latest.artifact?.digest, v3.digest);
    assert.notEqual(old.executionId, latest.executionId);
    assert.deepEqual(old.result, { ok: false, version: "V2", count: 1 });
    assert.deepEqual(latest.result, { ok: false, version: "V3", count: 1 });
    assert.equal(old.state, "completed");
    const before = downloads;
    const pinned = await task({ fail: true }, { digest: v2.digest });
    const fixed = await pinned.result();
    assert.equal(fixed.artifact?.digest, v2.digest);
    assert.equal(downloads, before, "fixed cache must not confirm floating URL again");
    assert.equal(await client.reference(v2.digest, "check"), "# V2\n");
    const restarted = new ArtifactManager(join(directory, "cache"), [origin], limits);
    const requestsBeforeRestart = downloads;
    assert.equal(
      (await restarted.resolve(`${origin}/unavailable`, v2.digest)).metadata.digest,
      v2.digest,
    );
    assert.equal(
      downloads,
      requestsBeforeRestart,
      "accurate disk cache survives manager restart without latest resolution",
    );
    const limited = new ArtifactManager(join(directory, "bounded-cache"), [origin], {
      ...limits,
      artifacts: 1,
    });
    current = v2.bytes;
    const retained = await limited.resolve(`${origin}/latest`);
    limited.retain(retained.metadata.digest);
    await delay(1);
    current = v3.bytes;
    await assert.rejects(
      limited.resolve(`${origin}/latest`),
      (error) => error instanceof TaskProtocolError && error.status === 429,
    );
    limited.release(retained.metadata.digest);
    const reclaimed = await limited.resolve(`${origin}/latest`);
    assert.equal(reclaimed.metadata.digest, v3.digest);
    await assert.rejects(limited.metadata(v2.digest), { status: 404 });
    await chmod(join(reclaimed.prepared.artifactDirectory, "worker.cjs"), 0o600);
    await writeFile(join(reclaimed.prepared.artifactDirectory, "worker.cjs"), "tampered");
    const beforeCorruption = downloads;
    await assert.rejects(
      limited.resolve(`${origin}/latest`, v3.digest),
      (error) =>
        error instanceof TaskProtocolError &&
        error.detail.code === "cache_invalid" &&
        error.detail.stage === "verify",
    );
    assert.equal(downloads, beforeCorruption, "corruption fails closed without network fallback");

    const idempotentRequest = { check: { url: `${origin}/latest` }, subject: { fail: true } };
    const admitted = await client.check(idempotentRequest, { idempotencyKey: "real-latest" });
    const original = await admitted.result();
    current = v2.bytes;
    const beforeRetry = downloads;
    const retry = await client.check(idempotentRequest, { idempotencyKey: "real-latest" });
    assert.equal(retry.taskId, admitted.taskId);
    assert.deepEqual(await retry.result(), original);
    assert.equal(downloads, beforeRetry);
    await assert.rejects(
      client.check({ ...idempotentRequest, subject: {} }, { idempotencyKey: "real-latest" }),
      { status: 409 },
    );
    current = v3.bytes;
    const resolved = await client.resolveArtifact(`${origin}/redirect`);
    assert.equal(resolved.digest, v3.digest);
    assert.ok(!JSON.stringify(resolved).includes("credential"));
    for (const path of ["/loop", "/downgrade", "/oversize", "/invalid"])
      await assert.rejects(client.resolveArtifact(`${origin}${path}`), TaskProtocolError);
    await assert.rejects(client.resolveArtifact("https://example.test/not-allowed"), {
      status: 403,
    });
    assert.equal(
      (await raw("/v2/check-tasks", "POST", { check: { digest: v2.digest }, subject: {} })).status,
      400,
    );
    assert.equal(
      (
        await raw("/v2/check-tasks", "POST", {
          check: { url: `${origin}/latest` },
          subject: {},
          timeoutMs: 0,
        })
      ).status,
      400,
    );
    assert.equal((await raw("/v2/events")).status, 400);
    assert.equal((await raw("/v2/events?taskId=missing")).status, 404);
    assert.equal((await raw(`/v2/check-tasks/${first.taskId}/events`)).status, 404);
    assert.equal((await fetch(`${host.endpoint}/v2/check-tasks/${first.taskId}`)).status, 401);

    // Same Client multiplexes observers; reconnecting/reading never repeats execution.
    const executions = kernel.diagnostics().executions;
    const [one, two] = await Promise.all([pinned.result(), pinned.result()]);
    assert.deepEqual(one, two);
    assert.equal(kernel.diagnostics().executions, executions);
    const controller = new AbortController();
    const seen: CheckTaskSnapshot[] = [];
    for await (const event of client.watchTasks([first, second], { signal: controller.signal })) {
      seen.push(event.snapshot);
      if (seen.length === 2) break;
    }
    assert.deepEqual(
      new Set(seen.map((state) => state.taskId)),
      new Set([first.taskId, second.taskId]),
    );
    assert.ok(seen.every((state) => state.state === "completed"));
    assert.equal(kernel.diagnostics().executions, executions);

    const largeA = await task({ bytes: 100_000 }, { digest: v3.digest });
    const largeB = await task({ bytes: 100_001 }, { digest: v3.digest });
    const large = await largeA.result();
    await largeB.result();
    assert.ok(large.result && typeof large.result === "object" && !Array.isArray(large.result));
    assert.equal(typeof large.result.blob, "string");
    assert.equal(large.result.blob?.toString().length, 100_000);
    const initialLarge: string[] = [];
    for await (const event of client.watchTasks([largeA, largeB])) {
      assert.equal(event.snapshot.state, "completed");
      initialLarge.push(event.taskId);
      if (initialLarge.length === 2) break;
    }
    assert.equal(
      new Set(initialLarge).size,
      2,
      "large initial frames must drain instead of disconnecting every reconnect",
    );

    const shared = await task({ wait: 450 }, { digest: v3.digest });
    await waitState(shared, "running");
    const weak = await task(
      { wait: 450 },
      { digest: v3.digest, freshness: "completed-after-request" },
    );
    await waitState(weak, "running");
    const strong = await task({ wait: 450 }, { digest: v3.digest });
    const sharedId = (await shared.snapshot()).executionId;
    assert.equal((await weak.snapshot()).executionId, sharedId);
    await shared.cancel();
    const [weakResult, strongResult] = await Promise.all([weak.result(), strong.result()]);
    assert.equal(weakResult.executionId, sharedId);
    assert.notEqual(strongResult.executionId, sharedId);
    await assert.rejects(
      shared.result(),
      (error) => error instanceof TaskProtocolError && error.detail.code === "task_cancelled",
    );

    const fastDeadline = await task({ wait: 450 }, { digest: v3.digest, timeoutMs: 80 });
    const longDeadline = await task(
      { wait: 450 },
      { digest: v3.digest, freshness: "completed-after-request" },
    );
    await assert.rejects(
      fastDeadline.result(),
      (error) => error instanceof TaskProtocolError && error.detail.code === "task_timeout",
    );
    assert.equal((await longDeadline.result()).state, "completed");

    const cleaned = join(directory, "cooperative-cleaned");
    const cooperative = await task({ wait: 5000, cleanup: cleaned }, { digest: v3.digest });
    await waitState(cooperative, "running");
    await delay(30);
    await cooperative.cancel();
    await waitUntil(async () => {
      try {
        return (await readFile(cleaned, "utf8")) === "clean";
      } catch {
        return false;
      }
    });
    assert.equal(kernel.diagnostics().ownedProcesses, 0);

    const spin = await task({ spin: true, process: true }, { digest: v3.digest });
    await waitState(spin, "running");
    await waitUntil(() => kernel.diagnostics().ownedProcesses === 1);
    const start = performance.now();
    const isolated = await task({ fail: true }, { digest: v3.digest });
    const otherResult = await isolated.result();
    assert.equal(otherResult.state, "completed");
    await assert.rejects(
      spin.result(),
      (error) => error instanceof TaskProtocolError && error.detail.code === "execution_timeout",
    );
    const elapsed = performance.now() - start;
    assert.ok(elapsed >= 800 && elapsed < 3500, `wall timeout bound ${elapsed}ms`);
    await waitUntil(() => kernel.diagnostics().retirements >= 1);
    await waitUntil(() => kernel.diagnostics().ownedProcesses === 0);
    await waitUntil(() => kernel.diagnostics().workers === 1);
    const afterKill = await task({ fail: true }, { digest: v3.digest });
    assert.equal((await afterKill.result()).state, "completed");
    assert.equal((await spin.snapshot()).state, "failed");
    assert.equal(kernel.diagnostics().ownedProcesses, 0);

    const failed = await task({ throw: true }, { digest: v3.digest });
    await assert.rejects(
      failed.result(),
      (error) => error instanceof TaskProtocolError && error.detail.code === "execution_failed",
    );
    assert.ok(!JSON.stringify(await failed.snapshot()).includes("private diagnostic"));
    const dirty = await task({ dirty: true }, { digest: v3.digest });
    await assert.rejects(
      dirty.result(),
      (error) =>
        error instanceof TaskProtocolError &&
        error.detail.code === "cleanup_failed" &&
        error.detail.stage === "cleanup",
    );

    // Normal TLS must reject the same endpoint without the explicit test trust root.
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        ["--input-type=module", "--eval", `await fetch(${JSON.stringify(`${origin}/latest`)})`],
        {
          env: { ...process.env, NODE_EXTRA_CA_CERTS: "", NODE_OPTIONS: "" },
          timeout: 10_000,
        },
      ),
    );
    console.log(
      JSON.stringify({
        v2: v2.digest,
        v3: v3.digest,
        sourceConfirmations: downloads,
        executions: kernel.diagnostics().executions,
        initializations: kernel.diagnostics().initializations,
        timeoutElapsedMs: elapsed,
        observations: [old.taskId, latest.taskId],
        isolated: otherResult.executionId,
      }),
    );
  } finally {
    client.close();
    await host.close();
    https.closeAllConnections();
    await new Promise<void>((resolve) => https.close(() => resolve()));
    await closePrivateFileBackend();
  }
});
