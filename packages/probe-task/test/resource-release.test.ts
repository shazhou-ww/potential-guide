import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { TaskSnapshot } from "@potential-guide/task-protocol";
import { createProbeTaskType } from "../src/index.js";

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
        submit: () => snapshot,
        getTask: () => snapshot,
        cancelTask: () => {
          canceled = true;
          return snapshot;
        },
        readHistory: () => {
          throw new Error("不应读取历史。");
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
    await type.resources!["child-submit"]!(null, context);
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
    await type.resources!["child-submit"]!(null, fresh);
    await type.resources!["run-dispose"]!(null, context);
    await assert.rejects(type.confirmResourceRelease!(fresh), { code: "reclamation_unknown" });
    next.abort();
    await type.confirmResourceRelease!(fresh);
  } finally {
    finish();
    await type.close();
  }
});
