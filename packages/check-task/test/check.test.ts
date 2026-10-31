import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  type ContractArtifact,
  checkerSchemaUri,
  inspectContractFiles,
} from "@potential-guide/check-artifacts/contracts";
import { newId } from "@potential-guide/task-engine";
import { MemoryStore, VirtualClock } from "@potential-guide/task-engine/testing";
import { startTaskServer } from "@potential-guide/task-engine-server";
import type { TaskSnapshot } from "@potential-guide/task-protocol";
import { TaskError } from "@potential-guide/task-protocol";
import { createFixtureEngine as createTaskEngine } from "../../task-engine/test/driver.js";
import type { ArtifactSource } from "../src/index.js";
import { createCheckFixture as createCheckTaskType } from "./type-fixture.js";

const caller = { scope: "a", subject: "tester" };
const reference = { kind: "checker" as const, url: "https://example.test/checker.tgz" };
export function artifact(
  source = "exports.execute=()=>({status:200,message:'',payload:{ok:true,problems:[]}})",
  minVersion = "22.13.0",
) {
  const page = Buffer.from("---\ntitle: Check\ndescription: Check\n---\nBody\n");
  return inspectContractFiles(
    new Map([
      [
        "checker.yaml",
        Buffer.from(
          JSON.stringify({
            $schema: checkerSchemaUri,
            runtime: { type: "node", minVersion },
            entry: "checker.cjs",
            subjectSchema: { type: "object" },
            problems: ["bad"],
            languages: ["en"],
          }),
        ),
      ],
      ["checker.cjs", Buffer.from(source)],
      ["references/en/checker.md", page],
      ["references/en/problems/bad.md", page],
    ]),
  );
}
async function wait(
  read: () => TaskSnapshot,
  predicate: (value: TaskSnapshot) => boolean,
  timeout = 8_000,
) {
  const until = Date.now() + timeout;
  for (;;) {
    const value = read();
    if (predicate(value)) return value;
    if (Date.now() > until) throw new Error(`Task stalled: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function harness(
  value: ContractArtifact,
  extra: { clock?: VirtualClock; limits?: { maxPayloadBytes: number } } = {},
) {
  const directory = resolve(".cache", `check-task-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  let allowed = true;
  const authorizations: string[] = [];
  const source: ArtifactSource = {
    authorize(_reference, scope) {
      authorizations.push(scope);
      if (!allowed) throw new Error("source denied");
    },
    async resolve() {
      return value;
    },
  };
  const type = createCheckTaskType({ source, directory, workers: 1, graceMs: 20 });
  const store = new MemoryStore();
  const engine = createTaskEngine({
    store,
    types: [type],
    currentVersions: { check: "2" },
    authorize: (who, _operation, scope) => who.scope === scope,
    ...extra,
  });
  engine.start();
  return {
    engine,
    store,
    type,
    authorizations,
    directory,
    deny() {
      allowed = false;
    },
    replace(artifact: ContractArtifact) {
      value = artifact;
    },
    submit(extraFields = {}) {
      return engine.submit(
        {
          requestId: newId(),
          type: "check",
          checker: reference,
          subject: {},
          timeoutMs: 10_000,
          ...extraFields,
        },
        caller,
      );
    },
    read(task: TaskSnapshot) {
      return engine.getTask(task.taskId, caller);
    },
    async close() {
      await engine.close();
      await type.close();
      assert.deepEqual(await readdir(directory), []);
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test("configured Engine budget admits verified artifact and business result above the default 64 KiB", async () => {
  const content = artifact(
    `/*${"x".repeat(100_000)}*/exports.execute=()=>({status:200,message:'',payload:{ok:false,problems:[{kind:'internal',id:'bad',parameters:{data:'x'.repeat(90_000)}}]}})`,
  );
  const h = await harness(content, { limits: { maxPayloadBytes: 1024 * 1024 } });
  try {
    const task = h.submit();
    const final = await wait(
      () => h.read(task),
      (item) => item.stage === "completed",
    );
    const result = (final.result as { result: { problems: { parameters: { data: string } }[] } })
      .result;
    assert.equal(result.problems[0]?.parameters.data.length, 90_000);
  } finally {
    await h.close();
  }
});
test("real worker reports normal business failure and provenance; strict input/result/runtime", async () => {
  const h = await harness(
    artifact(
      "exports.execute=(s,c)=>{c.progress({step:1});return {status:200,message:'',payload:{ok:false,problems:[{kind:'internal',id:'bad',parameters:{}}]}}}",
    ),
  );
  try {
    const task = h.submit();
    assert.throws(() => h.submit({ prerequisites: [] }), { code: "invalid_input" });
    const final = await wait(
      () => h.read(task),
      (value) => value.stage === "completed",
    );
    assert.deepEqual((final.result as { result: unknown }).result, {
      ok: false,
      problems: [{ kind: "internal", id: "bad", parameters: {} }],
    });
    const prepared = (
      final.result as unknown as { evidence: { prepared: import("../src/index.js").CheckPrepared } }
    ).evidence.prepared;
    assert.ok(prepared && typeof prepared === "object" && !Array.isArray(prepared));
    assert.equal(JSON.parse(prepared.environment as string).version, process.versions.node);
    assert.ok(h.authorizations.length >= 2);
    assert.ok(h.authorizations.every((scope) => scope === "a"));
    assert.throws(() => h.type.validatePrepared({ ...prepared, environment: "other" }), /binding/);
    assert.throws(() => h.type.validateProgress({ value: Number.NaN }), /finite/);
    const validateExecutionResult = h.type.validateExecutionResult;
    assert.ok(validateExecutionResult);
    assert.throws(
      () =>
        validateExecutionResult(
          { ok: true, problems: [], unknown: 1 },
          h.type.validatePrepared(prepared),
        ),
      /shape/,
    );
    assert.throws(
      () =>
        validateExecutionResult(
          { ok: false, problems: [{ kind: "internal", id: "unknown", parameters: {} }] },
          h.type.validatePrepared(prepared),
        ),
      /Undeclared/,
    );
    const history = h.engine.readHistory({ taskId: task.taskId }, {}, caller);
    assert.ok(history.events.some((event) => event.type === "run.progress"));
    assert.ok(
      history.events
        .filter((event) => event.type === "run.progress")
        .every((event) => !JSON.stringify(event.data).includes('"files"')),
    );
    assert.ok(
      JSON.stringify(history).includes('"files"'),
      "固定内容通过明确 Result 证据契约保留。",
    );
  } finally {
    await h.close();
  }
});
test("manifest and complete files may pass while actual runtime is unavailable; digest is pinned", async () => {
  for (const [value, fields, code] of [
    [artifact(undefined, "999.0.0"), {}, "unsupported_runtime"],
    [
      artifact(),
      { checker: { ...reference, digest: `sha256:${"0".repeat(64)}` } },
      "artifact_digest_mismatch",
    ],
  ] as const) {
    const h = await harness(value);
    try {
      const task = h.submit(fields);
      const final = await wait(
        () => h.read(task),
        (item) => item.stage === "run_failed",
      );
      assert.equal(final.error?.code, code);
      assert.equal(Object.keys(h.store.read().facts.runs).length, 1);
    } finally {
      await h.close();
    }
  }
});
test("undeclared problem, invocation failure, timer leak and failed dispose never become business results", async () => {
  for (const source of [
    "exports.execute=()=>({status:200,message:'',payload:{ok:false,problems:[{kind:'internal',id:'undeclared',parameters:{}}]}})",
    "exports.execute=()=>{throw Error('failed')}",
    "exports.execute=()=>{setInterval(()=>{},1000);return {status:200,message:'',payload:{ok:true,problems:[]}}}",
    "exports.execute=(s,c)=>{c.defer(()=>{throw Error('cleanup')});return {status:200,message:'',payload:{ok:true,problems:[]}}}",
    "exports.execute=()=>({status:200,message:'',payload:{ok:true,problems:[]}});exports.dispose=()=>{throw Error('dispose failed')}",
  ]) {
    const h = await harness(artifact(source));
    try {
      const task = h.submit();
      const final = await wait(
        () => h.read(task),
        (item) => item.stage === "run_failed",
      );
      assert.ok(
        final.result &&
          typeof final.result === "object" &&
          "failure" in final.result &&
          !("result" in final.result),
      );
      assert.equal(final.error?.code, "run_failed");
    } finally {
      await h.close();
    }
  }
});
test("owned subprocess leak fails and physical child exit is confirmed before capacity reuse", async () => {
  const h = await harness(
    artifact(
      "exports.execute=(s,c)=>{if(s.child){const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});c.progress({pid:child.pid})}return {status:200,message:'',payload:{ok:true,problems:[]}}}",
    ),
  );
  let ownedPid: number | undefined;
  try {
    const task = h.submit({ subject: { child: true } });
    const final = await wait(
      () => h.read(task),
      (item) => item.stage === "run_failed",
    );
    const trace = (final.result as { evidence: { businessProgress: { pid?: number }[] } }).evidence
      .businessProgress;
    ownedPid = trace.find((value) => value.pid !== undefined)?.pid;
    assert.ok(Number.isInteger(ownedPid));
    const next = h.submit({ subject: { child: false } });
    await wait(
      () => h.read(next),
      (item) => item.stage === "completed",
    );
    assert.throws(
      () => process.kill(ownedPid!, 0),
      (error: NodeJS.ErrnoException) => error.code === "ESRCH",
    );
  } finally {
    try {
      await h.close();
    } finally {
      stopOwnedTestChild(ownedPid);
    }
  }
});
function stopOwnedTestChild(pid: number | undefined) {
  if (!pid) return;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
  process.kill(pid, "SIGKILL");
}
test("shared real run has independent cancellation, idempotency and physical reclamation before reuse", async () => {
  const h = await harness(
    artifact(
      "exports.execute=async(s)=>{if(s.spin)while(true){};await new Promise(r=>setTimeout(r,350));return {status:200,message:'',payload:{ok:true,problems:[]}}}",
    ),
  );
  try {
    const a = h.submit();
    await wait(
      () => h.read(a),
      (item) => item.stage === "running",
    );
    const b = h.submit({ matchPolicy: "terminated-after-eligible" });
    assert.equal(h.read(b).stage, "initial");
    assert.equal(h.read(b).run, undefined);
    const original = h.engine.getRequest(b.requestId, caller);
    assert.equal(h.engine.submit(original, caller).taskId, b.taskId);
    h.engine.cancelTask(a.taskId, caller);
    assert.ok(h.read(a).canceledAt);
    assert.equal(
      (
        await wait(
          () => h.read(b),
          (item) => item.stage === "completed",
        )
      ).result !== undefined,
      true,
    );
    assert.equal(h.read(a).run?.runId, h.read(b).run?.runId);
    const stuck = h.submit({ subject: { spin: true } });
    await wait(
      () => h.read(stuck),
      (item) => item.stage === "running",
    );
    h.engine.cancelTask(stuck.taskId, caller);
    const next = h.submit({ subject: { different: true } });
    await wait(
      () => h.read(next),
      (item) => item.stage === "completed",
    );
    assert.notEqual(h.read(stuck).run?.runId, h.read(next).run?.runId);
    await h.engine.waitForTaskRelease(stuck.taskId, caller);
    assert.ok(h.store.read().facts.runs[h.read(stuck).run!.runId]?.reclaimedAt);
  } finally {
    await h.close();
  }
});
test("deterministic deadline projection records late worker completion without changing original deadline", async () => {
  const clock = new VirtualClock();
  const h = await harness(
    artifact(
      "exports.execute=async()=>{await new Promise(r=>setTimeout(r,100));return {status:200,message:'',payload:{ok:true,problems:[]}}}",
    ),
    { clock },
  );
  try {
    const task = h.submit({ timeoutMs: 10 });
    clock.advance(1);
    h.engine.tick();
    for (let index = 0; index < 60; index++) await Promise.resolve();
    h.engine.tick();
    for (let index = 0; index < 60; index++) await Promise.resolve();
    assert.equal(h.read(task).stage, "running");
    clock.advance(20);
    await wait(
      () => {
        h.engine.tick();
        return h.read(task);
      },
      (item) => item.stage === "completed",
    );
    assert.equal(h.read(task).stage, "completed");
    assert.ok(h.read(task).run!.completedAt! > h.read(task).deadlineAt);
    assert.equal(h.read(task).deadlineAt, task.deadlineAt);
  } finally {
    await h.close();
  }
});
test("input-equivalent mutable sources share the selected run, never bypass source authorization", async () => {
  const h = await harness(
    artifact(
      "exports.execute=async()=>{await new Promise(r=>setTimeout(r,200));return {status:200,message:'',payload:{ok:true,problems:[]}}}",
    ),
  );
  try {
    const a = h.submit();
    await wait(
      () => h.read(a),
      (item) =>
        !!item.run &&
        h.store
          .read()
          .events.some(
            (event) =>
              event.runId === item.run?.runId &&
              event.type === "run.progress" &&
              (event.data.progress as { stage?: string }).stage === "allocation",
          ),
    );
    h.replace(artifact());
    const b = h.submit({ matchPolicy: "terminated-after-eligible" });
    await wait(
      () => h.read(b),
      (item) => item.stage === "completed",
    );
    assert.equal(h.read(a).run?.runId, h.read(b).run?.runId);
    h.deny();
    const count = Object.keys(h.store.read().facts.tasks).length;
    const denied = h.submit({ matchPolicy: "terminated-after-eligible" });
    const rejected = await wait(
      () => h.read(denied),
      (item) => item.stage === "run_failed",
    );
    assert.match(rejected.error!.message, /denied/);
    assert.equal(Object.keys(h.store.read().facts.tasks).length, count + 1);
  } finally {
    await h.close();
  }
});
test("Check real HTTP/SSE authorization, shared cancellation, pagination and reconnect use generic protocol", async () => {
  const directory = resolve(".cache", `check-http-${randomUUID()}`);
  const content = artifact(
    "exports.execute=async(s,c)=>{c.progress({step:1});await new Promise(r=>setTimeout(r,500));return {status:200,message:'',payload:{ok:false,problems:[{kind:'internal',id:'bad',parameters:{}}]}}}",
  );
  const type = createCheckTaskType({
    directory,
    workers: 1,
    source: {
      authorize() {},
      async resolve() {
        return content;
      },
    },
  });
  const store = new MemoryStore();
  const server = await startTaskServer({
    types: [type],
    currentVersions: { check: "2" },
    store,
    port: 0,
    authorize: (who, _operation, scope) => who.scope === scope,
    resolveCaller(request) {
      if (request.headers.get("authorization") !== "Bearer test")
        throw new TaskError("unauthenticated", "Authentication required.");
      return caller;
    },
    closeResources: () => type.close(),
    http: { pollMs: 5 },
  });
  const headers = { authorization: "Bearer test", "content-type": "application/json" };
  const get = async (id: string) => {
    const response = await fetch(`${server.url}/tasks/${id}`, { headers });
    assert.equal(response.status, 200);
    return (await response.json()) as TaskSnapshot;
  };
  const until = async (id: string, stage: string) => {
    for (let count = 0; count < 500; count++) {
      const task = await get(id);
      if (task.stage === stage) return task;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Missing ${stage}`);
  };
  const submit = async (matchPolicy = "started-after-eligible") => {
    const response = await fetch(`${server.url}/tasks`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": newId() },
      body: JSON.stringify({
        type: "check",
        checker: reference,
        subject: {},
        timeoutMs: 10000,
        matchPolicy,
      }),
    });
    assert.equal(response.status, 202);
    return (await response.json()) as TaskSnapshot;
  };
  try {
    const a = await submit();
    await until(a.taskId, "running");
    const b = await submit("terminated-after-eligible");
    assert.equal((await get(b.taskId)).stage, "initial");
    assert.equal((await get(b.taskId)).run, undefined);
    assert.equal((await fetch(`${server.url}/tasks/${a.taskId}`)).status, 401);
    const canceled = await fetch(`${server.url}/tasks/${a.taskId}/cancel`, {
      method: "POST",
      headers,
    });
    assert.equal(canceled.status, 200);
    let cursor: string | undefined;
    const seen = new Set<number>();
    for (let connection = 0; connection < 3; connection++) {
      const response = await fetch(`${server.url}/events?taskId=${b.taskId}`, {
        headers: { ...headers, ...(cursor ? { "Last-Event-ID": cursor } : {}) },
      });
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();
      const text = new TextDecoder().decode((await reader.read()).value);
      cursor = /^id: (.+)$/m.exec(text)?.[1];
      assert.ok(cursor);
      const observation = JSON.parse(/^data: (.+)$/m.exec(text)![1]!);
      for (const event of observation.events) seen.add(event.sequence);
      await reader.cancel();
    }
    const final = await until(b.taskId, "completed");
    assert.equal((final.result as { result: { ok: boolean } }).result.ok, false);
    assert.ok((await get(a.taskId)).canceledAt);
    let next: string | undefined;
    const history: number[] = [];
    do {
      const url = new URL(`${server.url}/event-history?taskId=${b.taskId}&limit=1`);
      if (next) url.searchParams.set("cursor", next);
      const response = await fetch(url, { headers });
      const page = (await response.json()) as { events: { sequence: number }[]; next?: string };
      history.push(...page.events.map((event) => event.sequence));
      next = page.next;
    } while (next);
    assert.equal(history.length, new Set(history).size);
    assert.ok(history.length > 4);
    assert.ok([...seen].every((sequence) => history.includes(sequence)));
  } finally {
    await server.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
