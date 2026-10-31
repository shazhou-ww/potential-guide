import assert from "node:assert/strict";
import test from "node:test";
import { newId } from "@potential-guide/task-engine";
import { isTimedOut } from "@potential-guide/task-protocol";
import { probeResultReferences } from "../src/contracts.js";
import type { ProbeResult } from "../src/index.js";
import {
  binding,
  caller,
  checker,
  checkUrl,
  entries,
  harness,
  objective,
  pass,
  rootUrl,
  wait,
} from "./fixtures.js";

test("backward business clock between parent start and child submission preserves completion", async () => {
  let offset = 0;
  let h: Awaited<ReturnType<typeof harness>>;
  h = await harness(
    entries(),
    {
      children(scope) {
        offset = -20_000;
        return {
          service: h.engine,
          caller: { scope, subject: "trusted-probe" },
          waitForTaskRelease: (id, caller) => h.engine.waitForTaskRelease(id, caller),
        };
      },
    },
    {},
    {
      now: () => Date.now() + offset,
      schedule(callback, milliseconds) {
        const timer = setTimeout(callback, milliseconds);
        return () => clearTimeout(timer);
      },
    },
  );
  try {
    const task = h.submit();
    const final = await wait(
      () => h.read(task),
      (snapshot) => !!snapshot.run?.completedAt || !!snapshot.run?.failedAt,
    );
    const run = h.store.read().facts.runs[final.run!.runId]!;
    assert.ok(run.completedAt, JSON.stringify(run.error));
    assert.equal(run.error, undefined);
    const result = run.result as unknown as ProbeResult;
    const child = result.evidence.operations.find((entry) => "snapshot" in entry)!;
    assert.ok("snapshot" in child);
    assert.ok(
      child.snapshot.run!.startedAt < result.evidence.startedAt,
      "跨时钟回退依赖持久化接收顺序，而非跨实体墙钟顺序。",
    );
    assert.ok(child.snapshot.run!.startedAt >= child.snapshot.eligibleAt);
    assert.ok(child.snapshot.run!.completedAt! <= child.snapshot.deadlineAt);
    const events = h.store.read().events;
    const parentStart = events.find(
      (event) => event.type === "run.started" && event.runId === run.runId,
    )!;
    const childCreated = events.find(
      (event) => event.type === "task.created" && event.taskId === child.snapshot.taskId,
    )!;
    assert.ok(parentStart.sequence < childCreated.sequence);
    const prepared = result.evidence.prepared;
    h.probe.validateExecutionResult!(result, prepared);
    for (const boundary of ["eligible", "deadline"] as const) {
      const forged = structuredClone(result);
      const entry = forged.evidence.operations.find((entry) => "snapshot" in entry)!;
      assert.ok("snapshot" in entry);
      const snapshot = entry.snapshot;
      if (boundary === "eligible")
        snapshot.eligibleAt = new Date(Date.parse(snapshot.run!.startedAt) + 1).toISOString();
      if (boundary === "deadline")
        snapshot.deadlineAt = new Date(Date.parse(snapshot.run!.completedAt!) - 1).toISOString();
      assert.throws(
        () => h.probe.validateExecutionResult!(forged, prepared),
        /Child completion evidence/,
      );
    }
  } finally {
    await h.close();
  }
});

test("clock rollback during child run keeps engine-applicable completion evidence", async () => {
  let offset = 0;
  const h = await harness(
    entries(
      "exports.execute=async()=>{await new Promise(r=>setTimeout(r,300));return {status:200,message:'',payload:{ok:true,problems:[]}}}",
    ),
    {},
    {},
    {
      now: () => Date.now() + offset,
      schedule(callback, milliseconds) {
        const timer = setTimeout(callback, milliseconds);
        return () => clearTimeout(timer);
      },
    },
  );
  try {
    const parent = h.submit();
    let childId = "";
    for (let attempt = 0; attempt < 1000; attempt++) {
      const child = Object.values(h.store.read().facts.tasks).find(
        (task) => task.binding.type === "check" && task.snapshot.run,
      );
      if (child) {
        assert.equal(child.snapshot.run!.completedAt, undefined);
        childId = child.snapshot.taskId;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(childId, "A child must start before the business clock rolls back.");
    offset = -20_000;
    const final = await wait(
      () => h.read(parent),
      (snapshot) => !!snapshot.run?.completedAt || !!snapshot.run?.failedAt,
    );
    const child = h.engine.getTask(childId, caller);
    assert.equal(child.stage, "completed");
    assert.ok(child.run!.completedAt! < child.run!.startedAt);
    const run = h.store.read().facts.runs[final.run!.runId]!;
    assert.ok(run.completedAt, JSON.stringify(run.error));
    assert.equal(run.error, undefined);
    h.probe.validateExecutionResult!(
      run.result,
      (run.result as unknown as ProbeResult).evidence.prepared,
    );
  } finally {
    await h.close();
  }
});

test("cumulative levels, multiple Checks, immutable content, exact evidence and References", async () => {
  const artifacts = entries();
  const blocked = checker(
    "exports.execute=()=>({status:200,message:'',payload:{ok:false,problems:[{kind:'internal',id:'bad',parameters:{reason:'gap'}}]}})",
  );
  artifacts.set("https://example.test/blocked", blocked);
  const root = objective(
    {
      one: binding(artifacts.get(checkUrl)!),
      two: binding(blocked, "https://example.test/blocked"),
    },
    [
      { id: "first", checks: ["one"] },
      { id: "second", checks: ["one", "two"] },
      { id: "third", checks: ["one"] },
    ],
  );
  artifacts.set(rootUrl, root);
  const h = await harness(artifacts);
  try {
    const input = {
      objective: { kind: "objective", url: rootUrl, digest: root.digest },
      subject: { stable: 1 },
    };
    const task = h.submit(input);
    input.subject.stable = 9;
    const final = await wait(() => h.read(task));
    assert.equal(final.stage, "completed", JSON.stringify(final));
    const result = final.result as unknown as ProbeResult;
    assert.equal(result.observation.current.levelId, "first");
    assert.equal(result.observation.problems[0]?.levelId, "second");
    assert.equal(result.evidence.operations.length, 3);
    assert.equal(result.evidence.parentRunId, final.run?.runId);
    assert.equal(result.observation.current.objective.digest, root.digest);
    assert.equal(
      result.references.en?.["checkers/two/problems/bad"]?.origin.artifactDigest,
      blocked.digest,
    );
    const prepared = result.evidence.prepared;
    assert.equal(prepared.input.subject.stable, 1);
    assert.equal(JSON.parse(prepared.environment).policy.checkEnvironment, h.check.environment);
    const validate = h.probe.validateExecutionResult!;
    validate(result, prepared);
    for (const mutate of [
      (x: ProbeResult) => {
        x.observation.current.levelId = "third";
      },
      (x: ProbeResult) => {
        x.evidence.environment = "fake";
      },
      (x: ProbeResult) => {
        const entry = x.evidence.operations[0]!;
        if ("snapshot" in entry) entry.environment = "fake";
      },
      (x: ProbeResult) => {
        x.evidence.operations.reverse();
      },
    ]) {
      const modified = structuredClone(result);
      mutate(modified);
      assert.throws(() => validate(modified, prepared));
    }
    assert.throws(
      () => h.probe.validatePrepared({ ...prepared, environment: "fake" }),
      /environment/,
    );
    const modified = structuredClone(prepared);
    modified.root.files["objective.yaml"] = Buffer.from("{}").toString("base64");
    assert.throws(() => h.probe.validatePrepared(modified));
    const history = h.engine.readHistory({ taskId: task.taskId }, { limit: 100 }, caller);
    assert.ok(history.events.some((event) => event.type === "run.progress"));
    assert.throws(() =>
      h.engine.readHistory({ taskId: task.taskId }, {}, { ...caller, scope: "other" }),
    );
  } finally {
    await h.close();
  }
});

test("dynamic requirements resolve once, retain exact selection, recheck with generated context", async () => {
  const dependencyUrl = "https://example.test/dependency";
  const depCheckUrl = "https://example.test/dependency-check";
  const artifacts = entries(
    `exports.execute=(s,c)=>({status:200,message:'',payload:c.data.resolutions?c.data.resolutions[0].result:{ok:false,problems:[],requirements:[{objective:{kind:'objective',url:'${dependencyUrl}'},subject:{},expectedLevelId:'terminal'}]}})`,
  );
  const depCheck = checker(
    "exports.execute=()=>({status:200,message:'',payload:{ok:false,problems:[{kind:'internal',id:'bad',parameters:{}}]}})",
  );
  const dependency = objective({ check: binding(depCheck, depCheckUrl) });
  artifacts.set(dependencyUrl, dependency);
  artifacts.set(depCheckUrl, depCheck);
  const h = await harness(artifacts);
  try {
    const task = h.submit();
    const final = await wait(() => h.read(task));
    assert.equal(final.stage, "completed", JSON.stringify(final));
    const result = final.result as unknown as ProbeResult;
    assert.equal(result.observation.current.levelId, "initial");
    assert.equal(result.observation.problems[0]?.problem.kind, "dependency");
    assert.equal(result.observation.bindings[dependencyUrl], dependency.digest);
    assert.deepEqual(
      result.evidence.operations.map((entry) => entry.request.kind),
      ["check", "resolve", "check", "check"],
    );
    assert.deepEqual(
      probeResultReferences(final.result).map((reference) => reference.url),
      [checkUrl, dependencyUrl, dependencyUrl, depCheckUrl, checkUrl],
    );
    const history = h.engine.readHistory({ taskId: task.taskId }, { limit: 100 }, caller);
    assert.ok(history.events.some((event) => event.type === "run.completed"));
    assert.ok(result.evidence.operations.some((entry) => "content" in entry));
    assert.ok(
      result.evidence.operations.some((entry) => "snapshot" in entry && !!entry.snapshot.run),
    );
    const prepared = result.evidence.prepared;
    artifacts.delete(dependencyUrl);
    h.probe.validateExecutionResult!(result, prepared);
    const forged = structuredClone(result);
    const selection = forged.evidence.operations[1]!;
    if ("content" in selection) selection.content.reference.digest = `sha256:${"0".repeat(64)}`;
    assert.throws(() => h.probe.validateExecutionResult!(forged, prepared));
    assert.throws(() => h.submit({ context: { resolutions: [] } }));
    assert.throws(() => h.submit({ children: { subject: "admin" } }));
    h.source.authorize = (reference) => {
      if (reference.url === depCheckUrl) throw new Error("dynamic resource revoked");
    };
    assert.equal("authorize" in h.probe, false);
    assert.equal(h.engine.getTask(task.taskId, caller).stage, "completed");
    assert.throws(
      () => h.source.authorize({ kind: "checker", url: depCheckUrl }, caller.scope),
      /dynamic resource revoked/,
    );
  } finally {
    await h.close();
  }
});

test("authorization reference access rejects malformed operations instead of asserting result types", () => {
  for (const operation of [
    { request: {} },
    { request: { kind: "resolve", reference: { kind: "objective", url: rootUrl } } },
    {
      request: { kind: "check", reference: { kind: "checker", url: 42 } },
      snapshot: {},
      environment: "test",
    },
    {
      request: { kind: "resolve", reference: { kind: "objective", url: rootUrl } },
      content: { reference: { kind: "objective", url: rootUrl, digest: false } },
    },
  ]) {
    assert.throws(() =>
      probeResultReferences({
        observation: {},
        references: {},
        evidence: {
          parentRunId: newId(),
          startedAt: new Date().toISOString(),
          environment: "test",
          operations: [operation],
        },
      }),
    );
  }
});

test("unknown/invalid results and invented dependency evidence fail, not business gaps", async () => {
  for (const code of [
    "exports.execute=()=>({status:200,message:'',payload:{ok:false,problems:[{kind:'internal',id:'unknown',parameters:{}}]}})",
    "exports.execute=()=>({status:200,message:'',payload:{ok:true,problems:[{kind:'internal',id:'bad',parameters:{}}]}})",
    "exports.execute=()=>({status:200,message:'',payload:{ok:false,problems:[{kind:'dependency',objective:{kind:'objective',url:'https://example.test/fake'},subject:{},expectedLevelId:'ready',currentLevelId:'initial'}]}})",
  ]) {
    const h = await harness(entries(code));
    try {
      const task = h.submit();
      const final = await wait(() => h.read(task));
      assert.equal(final.stage, "run_failed", JSON.stringify(final));
      assert.ok(final.result && typeof final.result === "object" && "failure" in final.result);
    } finally {
      await h.close();
    }
  }
});

test("separate bounded parent allocation lane advances parallel parents with one Check worker", async () => {
  const h = await harness(
    entries(
      "exports.execute=async()=>{await new Promise(r=>setTimeout(r,30));return {status:200,message:'',payload:{ok:true,problems:[]}}}",
    ),
  );
  try {
    const tasks = Array.from({ length: 5 }, (_, id) => h.submit({ subject: { id } }));
    const results = await Promise.all(tasks.map((task) => wait(() => h.read(task))));
    assert.ok(
      results.every((result) => result.stage === "completed"),
      JSON.stringify(results),
    );
    assert.equal(h.check.diagnostics.running, 0);
    assert.equal(h.probe.diagnostics.quarantined, 0);
  } finally {
    await h.close();
  }
});

test("cancel parent detaches only its child Task; shared Check's independent owner survives", async () => {
  const h = await harness(
    entries(
      "exports.execute=async(s,c)=>{await new Promise(r=>setTimeout(r,600));return {status:200,message:'',payload:{ok:true,problems:[]}}}",
    ),
  );
  try {
    const parent = h.submit();
    let childId = "";
    for (let attempt = 0; attempt < 500; attempt++) {
      const child = Object.values(h.store.read().facts.tasks).find(
        (task) => task.binding.type === "check" && task.snapshot.run,
      );
      if (child) {
        childId = child.snapshot.taskId;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(childId);
    const child = h.engine.getTask(childId, caller);
    const request = h.engine.getRequest(child.requestId, caller);
    const independent = h.engine.submit(
      {
        ...request,
        requestId: newId(),
        eligibleAt: child.eligibleAt,
        matchPolicy: "terminated-after-eligible",
      },
      { scope: caller.scope, subject: "trusted-probe" },
    );
    assert.equal(h.read(independent).run, undefined);
    h.engine.cancelTask(parent.taskId, caller);
    const completed = await wait(() => h.read(independent));
    assert.equal(completed.stage, "completed");
    assert.equal(completed.run?.runId, child.run?.runId);
    assert.equal(h.engine.getTask(childId, caller).canceledAt !== undefined, true);
    assert.equal(completed.canceledAt, undefined);
  } finally {
    await h.close();
  }
});

test("Task deadline is not run cancellation; late parent success remains timed out", async () => {
  let offset = 0;
  const h = await harness(
    entries(
      "exports.execute=async()=>{await new Promise(r=>setTimeout(r,100));return {status:200,message:'',payload:{ok:true,problems:[]}}}",
    ),
    {},
    {},
    {
      now: () => Date.now() + offset,
      schedule(callback, milliseconds) {
        const timer = setTimeout(callback, milliseconds);
        return () => clearTimeout(timer);
      },
    },
  );
  try {
    const task = h.submit({ timeoutMs: 10000 });
    const snapshot = await wait(
      () => h.read(task),
      (value) => !!value.run || !!value.error,
    );
    assert.ok(snapshot.run);
    offset = 20000;
    const expired = await wait(() => h.read(task));
    assert.ok(isTimedOut(expired));
    for (let count = 0; count < 1000; count++) {
      if (h.store.read().facts.runs[snapshot.run.runId]?.completedAt) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(h.read(task).stage, "completed");
    assert.ok(isTimedOut(h.read(task)));
    const run = h.store.read().facts.runs[snapshot.run.runId]!;
    assert.ok(run.completedAt);
    assert.equal(run.error, undefined);
  } finally {
    await h.close();
  }
});

test("wall/depth/check-count budgets stop exact owned work and physically release resources", async () => {
  const h = await harness(entries("exports.execute=()=>{while(true){}}"), { wallMs: 250 });
  try {
    const task = h.submit();
    const final = await wait(() => h.read(task));
    assert.equal(final.stage, "run_failed");
    assert.match(final.error!.message, /wall|interrupted/i);
    assert.equal(h.probe.diagnostics.quarantined, 0);
    await h.engine.waitForTaskRelease(task.taskId, caller);
    assert.equal(h.check.diagnostics.running, 0);
  } finally {
    await h.close();
  }
  const artifacts = entries();
  const check = artifacts.get(checkUrl)!;
  artifacts.set(rootUrl, objective({ a: binding(check), b: binding(check) }));
  const bounded = await harness(artifacts, { maxChecks: 1 });
  try {
    const task = bounded.submit();
    const final = await wait(() => bounded.read(task));
    assert.equal(final.stage, "run_failed");
    assert.match(final.error!.message, /budget/);
  } finally {
    await bounded.close();
  }
});

test("initial observation performs no Check and pinned input rejects differing content", async () => {
  const h = await harness(entries(pass));
  try {
    const initial = h.submit({ targetLevel: "initial" });
    const done = await wait(() => h.read(initial));
    assert.equal(done.stage, "completed");
    assert.equal((done.result as unknown as ProbeResult).evidence.operations.length, 0);
    const bad = h.submit({
      objective: { kind: "objective", url: rootUrl, digest: `sha256:${"0".repeat(64)}` },
    });
    assert.equal((await wait(() => h.read(bad))).stage, "run_failed");
  } finally {
    await h.close();
  }
});
test("deterministic parent wall expiration confirms active child physical cleanup before reuse", async () => {
  const walls: (() => void)[] = [];
  const h = await harness(
    entries("exports.execute=()=>{while(true){}}"),
    {},
    { executionWallMs: 7777 },
    {
      now: () => Date.now(),
      schedule(callback, milliseconds) {
        if (milliseconds === 7777) {
          walls.push(callback);
          return () => {};
        }
        const timer = setTimeout(callback, milliseconds);
        return () => clearTimeout(timer);
      },
    },
  );
  try {
    const task = h.submit();
    let childId = "";
    for (let attempt = 0; attempt < 2000; attempt++) {
      const child = Object.values(h.store.read().facts.tasks).find(
        (item) => item.binding.type === "check" && item.snapshot.run,
      );
      if (child) {
        childId = child.snapshot.taskId;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(childId, "A real child must have crossed its durable start boundary.");
    assert.ok(
      Object.values(h.store.read().facts.runs).some(
        (run) => run.binding.type === "check" && !run.completedAt && !run.failedAt,
      ),
    );
    walls[0]!();
    const final = await wait(() => h.read(task));
    assert.equal(final.stage, "run_failed");
    assert.equal(final.error?.code, "execution_wall_limit");
    await h.engine.waitForTaskRelease(task.taskId, caller);
    const child = h.engine.getTask(childId, caller);
    assert.ok(child.canceledAt);
    assert.ok(h.store.read().facts.runs[child.run!.runId]?.reclaimedAt);
    assert.equal(h.check.diagnostics.running, 0);
    assert.equal(h.probe.diagnostics.running, 0);
    assert.equal(h.probe.diagnostics.quarantined, 0);
  } finally {
    await h.close();
  }
});

test("recursive depth and unknown dynamic target are diagnosed without regulation", async () => {
  for (const [expected, policy, message] of [
    ["ready", { maxDepth: 1 }, /budget/],
    ["unknown", {}, /Unknown dependency target/],
  ] as const) {
    const artifacts = entries(
      `exports.execute=(s)=>({status:200,message:'',payload:{ok:false,problems:[],requirements:[{objective:{kind:'objective',url:'${rootUrl}'},subject:{depth:(s.depth||0)+1},expectedLevelId:'${expected}'}]}})`,
    );
    const h = await harness(artifacts, policy);
    try {
      const task = h.submit();
      const final = await wait(() => h.read(task));
      assert.equal(final.stage, "run_failed");
      assert.match(final.error!.message, message);
      assert.ok(
        Object.values(h.store.read().facts.tasks).every((task) =>
          ["probe", "check"].includes(task.binding.type),
        ),
      );
    } finally {
      await h.close();
    }
  }
});

test("trusted caller must preserve scope and actual child environment must match preparation", async () => {
  for (const options of [
    { checkEnvironment: "not-the-installed-runtime" },
    {
      children: () => ({
        service: {} as never,
        caller: { scope: "other", subject: "admin" },
        async waitForTaskRelease() {},
      }),
    },
  ]) {
    const h = await harness(entries(), options);
    try {
      const task = h.submit();
      const final = await wait(() => h.read(task));
      assert.equal(final.stage, "run_failed");
      assert.match(final.error!.message, /scope|runtime/);
    } finally {
      await h.close();
    }
  }
});
