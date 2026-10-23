import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, SubscriptionRef, startEffect } from "@potential-guide/effects";
import { CheckKernel, connectHost, readArtifact, serve } from "../../check-host/dist/index.js";
import {
  createHttpCheckProbe,
  createMemoryCheckProbe,
  createProcessCheckProbe,
  createWorkerCheckProbe,
  observe,
} from "../src/index.js";
import { fixture } from "./fixtures.js";

const fail = {
  status: 200,
  message: "",
  payload: {
    ok: false,
    problems: [{ kind: "internal" as const, id: "missing", parameters: { observed: 2 } }],
  },
} as const;
const subject = { root: "subject-json-only" };
const signal = new AbortController().signal;

async function withWorker(
  source: string,
  use: (probe: ReturnType<typeof createWorkerCheckProbe>, kernel: CheckKernel) => Promise<void>,
) {
  const parent = resolve(".cache");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "worker-probe-"));
  const directory = join(root, "artifact");
  await mkdir(directory);
  await writeFile(join(directory, "worker.cjs"), source);
  const kernel = await CheckKernel.create(join(root, "snapshots"));
  const token = crypto.randomUUID();
  const host = await serve(kernel, token);
  const previous = process.env.PGUIDE_CHECK_HOST_DIRECTORY;
  try {
    await writeFile(
      join(root, "host.json"),
      JSON.stringify({
        endpoint: host.endpoint,
        token,
        pid: process.pid,
        instance: crypto.randomUUID(),
      }),
      { flag: "wx" },
    );
    process.env.PGUIDE_CHECK_HOST_DIRECTORY = root;
    await connectHost(root);
    const artifact = await readArtifact(directory);
    await use(
      createWorkerCheckProbe({
        directory: artifact.directory,
        revision: artifact.revision,
        evidence: false,
      }),
      kernel,
    );
  } finally {
    if (previous === undefined) delete process.env.PGUIDE_CHECK_HOST_DIRECTORY;
    else process.env.PGUIDE_CHECK_HOST_DIRECTORY = previous;
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("process timeout metadata is runtime-owned and preserves the 30s default", async () => {
  const previous = process.env.PGUIDE_PROBE_TIMEOUT_MS;
  process.env.PGUIDE_PROBE_TIMEOUT_MS = "999999";
  try {
    for (const timeoutMs of [undefined, 75000]) {
      const result = await createProcessCheckProbe({
        command: process.execPath,
        args: [
          "-e",
          'console.log(JSON.stringify({status:200,message:"",payload:{ok:false,problems:[{kind:"internal",id:"missing",parameters:{timeoutMs:process.env.PGUIDE_PROBE_TIMEOUT_MS}}]}}))',
        ],
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      })(subject, signal);
      const problem = result.payload?.problems[0];
      assert.ok(problem?.kind === "internal");
      assert.equal(problem.parameters.timeoutMs, String(timeoutMs ?? 30000));
    }
  } finally {
    if (previous === undefined) delete process.env.PGUIDE_PROBE_TIMEOUT_MS;
    else process.env.PGUIDE_PROBE_TIMEOUT_MS = previous;
  }
});

test("in-memory and real process probes share business-failure envelope and subject JSON", async () => {
  const memory = createMemoryCheckProbe((input) => {
    assert.deepEqual(input, subject);
    return fail;
  });
  let logs = "";
  const script = `
    let source="";process.stdin.setEncoding("utf8");process.stdin.on("data", c=>source+=c);
    process.stdin.on("end",()=>{
      const subject=JSON.parse(source);
      if(subject.root!=="subject-json-only"||"subject" in subject)process.exit(4);
      process.stderr.write(process.env.PGUIDE_PROBE_TEMP_DIR);
      process.stdout.write(${JSON.stringify(JSON.stringify(fail))});
    });
  `;
  const child = createProcessCheckProbe({
    command: process.execPath,
    args: ["-e", script],
    log: (text) => {
      logs += text;
    },
  });
  assert.deepEqual(await memory(subject, signal), fail);
  assert.deepEqual(await child(subject, signal), fail);
  assert.match(logs, /pguide-check-/);
  await assert.rejects(stat(logs), { code: "ENOENT" });
});

test("legacy bare-subject HTTP factory is explicitly rejected", () => {
  assert.throws(() => createHttpCheckProbe("http://127.0.0.1:1"), /Legacy bare-subject HTTP/);
});

test("worker probes send the subject once and preserve business failure envelopes", async () => {
  await withWorker(
    `
exports.execute=async(subject)=>{
  if(subject.root!=="subject-json-only" || "subject" in subject)throw Error("Wrong subject");
  return ${JSON.stringify(fail)};
};`,
    async (probe) => {
      assert.deepEqual(await probe(subject, signal), fail);
    },
  );
});

test("transport failures and malformed process output cannot look like business defects", async () => {
  for (const script of [
    "process.stdout.write('not json')",
    "process.stdout.write(JSON.stringify({pass:false}));",
    `process.stdout.write(${JSON.stringify(JSON.stringify(fail))});process.exitCode=7;`,
  ]) {
    const result = await createProcessCheckProbe({
      command: process.execPath,
      args: ["-e", script],
    })(subject, signal);
    assert.ok(result.payload === null);
    assert.equal(result.payload !== null, false);
  }
  const memory = await createMemoryCheckProbe(() => {
    throw new Error("offline");
  })(subject, signal);
  assert.ok(memory.payload === null);
  assert.match(memory.message, /offline/);
});

test("process cancellation terminates the process tree and removes only its own temp directory", async () => {
  let ready: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let logs = "";
  const script = `
    const {spawn}=require("node:child_process");
    const child=spawn(process.execPath,["-e","process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{stdio:["ignore","pipe","ignore"],detached:process.platform!=="win32"});
    child.stdout.once("data",()=>{
      child.stdout.destroy();
      process.stderr.write(JSON.stringify({directory:process.env.PGUIDE_PROBE_TEMP_DIR,pid:child.pid})+"\\n");
    });
    setInterval(()=>{},1000);
  `;
  const controller = new AbortController();
  const work = createProcessCheckProbe({
    command: process.execPath,
    args: ["-e", script],
    timeoutMs: 5000,
    gracePeriodMs: 50,
    log: (text) => {
      logs += text;
      if (logs.includes("\n")) ready?.();
    },
  })(subject, controller.signal);
  await started;
  const metadata: { directory: string; pid: number } = JSON.parse(logs.trim());
  controller.abort(new Error("parent cancelled"));
  await assert.rejects(work, /parent cancelled/);
  await assert.rejects(stat(metadata.directory), { code: "ENOENT" });
  let alive = true;
  const deadline = performance.now() + 2000;
  while (alive && performance.now() < deadline) {
    try {
      process.kill(metadata.pid, 0);
      await delay(10);
    } catch (cause) {
      assert.equal((cause as NodeJS.ErrnoException).code, "ESRCH");
      alive = false;
    }
  }
  assert.equal(alive, false, "descendant must be terminated before cancellation cleanup completes");
});

test("process timeout returns an invocation fault and reclaims its resources", async (t) => {
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const controller = new AbortController();
  let logs = "";
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    watchdog = nativeSetTimeout(
      () => reject(new Error("Process readiness/cleanup exceeded 15s.")),
      15_000,
    );
  });
  // Child startup has a real watchdog; the probe's exact 200ms clock advances after readiness.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let expired = false;
  const cleanupClock = setInterval(() => {
    if (expired) t.mock.timers.tick(10);
  }, 10);
  const work = createProcessCheckProbe({
    command: process.execPath,
    args: [
      "-e",
      'process.stderr.write(JSON.stringify({directory:process.env.PGUIDE_PROBE_TEMP_DIR,pid:process.pid})+"\\n");setInterval(()=>{},1000);',
    ],
    timeoutMs: 200,
    gracePeriodMs: 25,
    log: (text) => {
      logs += text;
      if (logs.includes("\n")) ready();
    },
  })(subject, controller.signal);
  try {
    await Promise.race([
      started,
      work.then(() => {
        throw new Error("Process exited before readiness.");
      }),
      deadline,
    ]);
    const metadata: { directory: string; pid: number } = JSON.parse(logs.trim());
    let settled = false;
    void work.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    t.mock.timers.tick(199);
    await Promise.resolve();
    assert.equal(settled, false, "The 200ms deadline must not fire at 199ms.");
    assert.ok((await stat(metadata.directory)).isDirectory());
    process.kill(metadata.pid, 0);
    t.mock.timers.tick(1);
    expired = true;
    const result = await Promise.race([work, deadline]);
    assert.equal(result.status, 504);
    assert.ok(result.payload === null);
    assert.match(result.message, /^timeout: check-timeout: .*: Check timed out after 200ms\.$/);
    assert.match(logs, /pguide-check-/);
    await assert.rejects(stat(metadata.directory), { code: "ENOENT" });
    assert.throws(() => process.kill(metadata.pid, 0), { code: "ESRCH" });
  } finally {
    controller.abort(new Error("Timeout fixture cleanup"));
    expired = true;
    let cleanupWatchdog: ReturnType<typeof setTimeout> | undefined;
    const cleanupDeadline = new Promise<never>((_, reject) => {
      cleanupWatchdog = nativeSetTimeout(
        () => reject(new Error("Process fixture did not finish cancellation cleanup.")),
        5_000,
      );
    });
    try {
      await Promise.race([work.catch(() => undefined), cleanupDeadline]);
    } finally {
      clearInterval(cleanupClock);
      if (watchdog !== undefined) nativeClearTimeout(watchdog);
      if (cleanupWatchdog !== undefined) nativeClearTimeout(cleanupWatchdog);
      t.mock.timers.reset();
    }
  }
});

test("worker cancellation waits for Host cleanup before rejecting the caller", async () => {
  await withWorker(
    `
exports.execute=async(subject,context)=>{
  context.progress("ready");
  await new Promise(done=>{
    context.signal.addEventListener("abort",done,{once:true});
    context.defer(()=>context.signal.removeEventListener("abort",done));
    if(context.signal.aborted)done();
  });
  return ${JSON.stringify(fail)};
};`,
    async (probe, kernel) => {
      const controller = new AbortController();
      const work = probe(subject, controller.signal);
      const deadline = Date.now() + 10_000;
      let id = "";
      try {
        while (Date.now() < deadline) {
          id = Effect.runSync(SubscriptionRef.get(kernel.active))[0]?.checkId ?? "";
          const state = id ? kernel.sample(id) : undefined;
          if (state?.state === "Running" && state.progress === "ready") break;
          await delay(5);
        }
        assert.ok(id && Date.now() < deadline, "Worker must be ready before cancellation.");
        controller.abort(new Error("local cancel"));
        await assert.rejects(work, /local cancel/);
        assert.equal(kernel.sample(id).state, "Cancelled");
      } finally {
        controller.abort();
        await work.catch(() => {});
      }
    },
  );
});

test("already aborted probes never start user code, a Host request, or a process", async () => {
  const controller = new AbortController();
  controller.abort(new Error("pre-cancelled"));
  let calls = 0;
  const memory = createMemoryCheckProbe(() => {
    calls++;
    return fail;
  });

  await assert.rejects(memory(subject, controller.signal), /pre-cancelled/);
  await assert.rejects(
    createProcessCheckProbe({ command: "must-not-launch" })(subject, controller.signal),
    /pre-cancelled/,
  );
  await assert.rejects(
    createWorkerCheckProbe({
      directory: "must-not-read",
      revision: "0".repeat(64),
      evidence: false,
    })(subject, controller.signal),
    /pre-cancelled/,
  );
  assert.equal(calls, 0);
});

test("native Pilot interruption awaits its probe finalizer before exposing completion", async () => {
  const spec = await fixture().load();
  let ready: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let directory = "";
  const probe = createProcessCheckProbe({
    command: process.execPath,
    args: [
      "-e",
      'process.stderr.write(process.env.PGUIDE_PROBE_TEMP_DIR+"\\n");setInterval(()=>{},1000);',
    ],
    gracePeriodMs: 25,
    log: (text) => {
      directory += text;
      if (directory.includes("\n")) ready?.();
    },
  });
  const running = startEffect(
    observe({ spec, subject: { name: "repo" } }, { resolveCheck: () => probe }),
  );
  await started;
  running.cancel();
  await assert.rejects(running.await());
  await assert.rejects(stat(directory.trim()), { code: "ENOENT" });
});
