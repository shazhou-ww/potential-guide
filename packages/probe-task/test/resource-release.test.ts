import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { HistoryPage, RunSnapshot, TaskSnapshot } from "@potential-guide/task-protocol";
import { createProbeTaskType } from "../src/index.js";

test("独立子 Run 观察沿用 Engine 已配置的预算，不被桥接默认 64 KiB 二次截断", async () => {
  const result = { evidence: "x".repeat(80 * 1024) };
  const snapshot = { taskId: "child", run: { runId: "run" }, result } as unknown as TaskSnapshot;
  const run = { runId: "run", result } as unknown as RunSnapshot;
  const history = {
    events: [{ sequence: 1, revision: "domain:1", type: "run.evidence", data: result }],
    items: [],
    revision: "domain:1",
    watermark: 1,
    cursor: "cursor",
  } as unknown as HistoryPage;
  const type = createProbeTaskType({
    checkEnvironment: "test",
    source: {
      authorize() {},
      async resolve() {
        throw new Error("No artifact read.");
      },
    },
    children: (scope) => ({
      caller: { scope, subject: "host" },
      service: {
        submit: async () => ({ status: "accepted", requestId: "request", taskId: snapshot.taskId }),
        getRequestStatus: async () => ({
          status: "accepted",
          requestId: "request",
          taskId: snapshot.taskId,
        }),
        getTask: () => snapshot,
        cancelTask: () => ({ ...snapshot, changed: true }),
        readHistory: () => history,
        getRun: () => run,
        getRunHistory: () => history,
      },
      waitForTaskRelease: async () => {},
    }),
  });
  const context = {
    runId: "parent",
    scope: "scope",
    signal: new AbortController().signal,
    workerGeneration: "one",
  };
  try {
    assert.deepEqual(await type.resources!["child-submit"]!({ requestId: "request" }, context), {
      status: "accepted",
      requestId: "request",
      taskId: snapshot.taskId,
    });
    assert.deepEqual(await type.resources!["child-run"]!({ runId: "run" }, context), run);
    assert.deepEqual(
      await type.resources!["child-run-history"]!({ runId: "run", page: {} }, context),
      history,
    );
    await type.resources!["child-release"]!({ taskId: "child" }, context);
    await type.resources!["run-dispose"]!(null, context);
  } finally {
    await type.close();
  }
});

test("父 Run 的资源请求返回子句柄不代表已回收；宿主证明等待子需求物理释放", async () => {
  let finish!: () => void;
  const release = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let canceled = false,
    proved = false;
  const snapshot = { taskId: "child" } as TaskSnapshot;
  const type = createProbeTaskType({
    checkEnvironment: "test",
    source: {
      authorize() {},
      async resolve() {
        throw new Error("不应读取制品。");
      },
    },
    children: (scope) => ({
      caller: { scope, subject: "host" },
      service: {
        submit: async () => ({ status: "accepted", requestId: "request", taskId: snapshot.taskId }),
        getRequestStatus: async () => ({
          status: "accepted",
          requestId: "request",
          taskId: snapshot.taskId,
        }),
        getTask: () => snapshot,
        cancelTask: () => {
          canceled = true;
          return { ...snapshot, changed: true };
        },
        readHistory: () => {
          throw new Error("不应读取历史。");
        },
        getRun: () => {
          throw new Error("不应读取 Run。");
        },
        getRunHistory: () => {
          throw new Error("不应读取 Run 历史。");
        },
      },
      waitForTaskRelease: () => release,
    }),
  });
  const controller = new AbortController();
  const context = {
    runId: "parent",
    scope: "scope",
    signal: controller.signal,
    workerGeneration: "one",
  };
  try {
    await type.resources!["child-submit"]!({ requestId: "request" }, context);
    await assert.rejects(type.confirmResourceRelease!({ ...context, workerGeneration: "one" }), {
      code: "reclamation_unknown",
    });
    controller.abort();
    const proof = type.confirmResourceRelease!({ ...context, workerGeneration: "one" }).then(() => {
      proved = true;
    });
    await delay(10);
    assert.equal(canceled, true);
    assert.equal(proved, false);
    finish();
    await proof;
    assert.equal(proved, true);
    await type.resources!["run-dispose"]!(null, context);
    const next = new AbortController();
    const fresh = { ...context, signal: next.signal, workerGeneration: "two" };
    await type.resources!["child-submit"]!({ requestId: "fresh-request" }, fresh);
    await type.resources!["run-dispose"]!(null, context);
    await assert.rejects(type.confirmResourceRelease!(fresh), { code: "reclamation_unknown" });
    next.abort();
    await type.confirmResourceRelease!(fresh);
  } finally {
    finish();
    await type.close();
  }
});
