import assert from "node:assert/strict";
import { once } from "node:events";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { startEffect } from "@potential-guide/effects";
import {
  createHttpCheckProbe,
  createMemoryCheckProbe,
  createProcessCheckProbe,
  observe,
} from "../src/index.js";
import { fixture } from "./fixtures.js";

const fail = {
  status: 200,
  message: "",
  payload: { ok: false, problems: [{ id: "missing", parameters: { observed: 2 } }] },
} as const;
const subject = { root: "subject-json-only" };
const signal = new AbortController().signal;

test("process timeout metadata is runtime-owned and preserves the 30s default", async () => {
  const previous = process.env.PGUIDE_PROBE_TIMEOUT_MS;
  process.env.PGUIDE_PROBE_TIMEOUT_MS = "999999";
  try {
    for (const timeoutMs of [undefined, 75000]) {
      const result = await createProcessCheckProbe({
        command: process.execPath,
        args: [
          "-e",
          'console.log(JSON.stringify({status:200,message:"",payload:{ok:false,problems:[{id:"missing",parameters:{timeoutMs:process.env.PGUIDE_PROBE_TIMEOUT_MS}}]}}))',
        ],
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      })(subject, signal);
      assert.equal(result.payload?.problems[0]?.parameters.timeoutMs, String(timeoutMs ?? 30000));
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

test("real HTTP probe posts subject JSON and treats business failure as HTTP 200 success", async (t) => {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    assert.deepEqual(JSON.parse(body), subject);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(fail));
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const probe = createHttpCheckProbe(`http://127.0.0.1:${address.port}`);
  assert.deepEqual(await probe(subject, signal), fail);
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
    const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
    process.stderr.write(JSON.stringify({directory:process.env.PGUIDE_PROBE_TEMP_DIR,pid:child.pid})+"\\n");
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

test("process timeout returns an invocation fault and reclaims its resources", async () => {
  let logs = "";
  const result = await createProcessCheckProbe({
    command: process.execPath,
    args: [
      "-e",
      "process.stderr.write(process.env.PGUIDE_PROBE_TEMP_DIR);setInterval(()=>{},1000);",
    ],
    timeoutMs: 200,
    gracePeriodMs: 25,
    log: (text) => {
      logs += text;
    },
  })(subject, signal);
  assert.ok(result.payload === null);
  assert.match(result.message, /^timeout:/);
  assert.match(logs, /pguide-check-/);
  await assert.rejects(stat(logs), { code: "ENOENT" });
});

test("HTTP cancellation is local and does not promise remote business termination", async (t) => {
  let received: (() => void) | undefined;
  const requestReceived = new Promise<void>((resolve) => {
    received = resolve;
  });
  let completed: (() => void) | undefined;
  const remoteCompleted = new Promise<void>((resolve) => {
    completed = resolve;
  });
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* consume subject before server-side work */
    }
    received?.();
    await delay(30);
    response.end(JSON.stringify(fail));
    completed?.();
  });
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const controller = new AbortController();
  const work = createHttpCheckProbe(`http://127.0.0.1:${address.port}`)(subject, controller.signal);
  await requestReceived;
  controller.abort(new Error("local cancel"));
  await assert.rejects(work, /local cancel/);
  await remoteCompleted;
});

test("already aborted probes never start user code, HTTP, or a process", async () => {
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
    createHttpCheckProbe("http://127.0.0.1:1")(subject, controller.signal),
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
