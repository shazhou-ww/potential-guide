import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { Json, TypeWorkerRegistration } from "@potential-guide/task-protocol";
import { type TypeChannel, TypeSupervisor } from "../src/type-supervisor.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((a) => {
    resolve = a;
  });
  return { promise, resolve };
}
function fixture(messageSchema: Json = false) {
  const progress: { runId: string; value: Json }[] = [];
  const results = new Map<string, Json>();
  const failures = new Map<string, string>();
  const released = new Set<string>();
  const loss = deferred<readonly string[]>();
  const confirmations: { runId: string; taskId: string; messageId: string }[] = [];
  const channel: TypeChannel = {
    async progress(runId, value) {
      progress.push({ runId, value });
    },
    async complete(runId, value) {
      results.set(runId, value);
    },
    async failed(runId, error) {
      failures.set(runId, error.code);
    },
    async confirm(runId, taskId, messageId) {
      confirmations.push({ runId, taskId, messageId });
    },
    released(runId) {
      released.add(runId);
    },
    lost(runIds) {
      loss.resolve(runIds);
    },
  };
  const registration: TypeWorkerRegistration = {
    type: "isolated",
    version: "1",
    environment: "trusted",
    inputSchema: { type: "object" },
    resultSchema: true,
    messageSchema: messageSchema as TypeWorkerRegistration["messageSchema"],
    module: new URL("./isolated-type.mjs", import.meta.url).href,
    exportName: "createType",
    configuration: { messageSchema },
  };
  const supervisor = new TypeSupervisor(registration, channel, {
    heartbeatMs: 20,
    healthMs: 5000,
    maxInFlight: 8,
    maxPayloadBytes: 65_536,
  });
  return {
    supervisor,
    registration,
    channel,
    progress,
    results,
    failures,
    released,
    loss,
    confirmations,
  };
}
async function until(predicate: () => boolean) {
  const end = performance.now() + 5000;
  while (!predicate()) {
    if (performance.now() > end) assert.fail("隔离类型测试等待超时。");
    await delay(5);
  }
}

test("类型模块运行在独立堆，同一守护支持多 Run 和指定 Run 取消", async () => {
  const f = fixture();
  try {
    await Promise.all([
      f.supervisor.run("a", { kind: "wait" }, "scope-a"),
      f.supervisor.run("b", { kind: "wait" }, "scope-b"),
    ]);
    await until(() => f.progress.length === 2);
    f.supervisor.cancel("a");
    await until(() => f.released.has("a"));
    assert.equal(f.released.has("b"), false);
    assert.deepEqual(f.results.get("a"), { runId: "a", scope: "scope-a", canceled: true });
    f.supervisor.cancel("b");
    await until(() => f.released.has("b"));
  } finally {
    f.supervisor.cancel("a");
    f.supervisor.cancel("b");
    await until(() => f.released.size === 2);
    await f.supervisor.close();
  }
});

test("进度确认等待宿主接纳边界，不把 postMessage 当作完成", async () => {
  const f = fixture();
  const barrier = deferred<void>();
  let received = false;
  f.channel.progress = async () => {
    received = true;
    await barrier.promise;
  };
  try {
    await f.supervisor.run("progress", {}, "scope");
    await until(() => received);
    assert.equal(f.results.size, 0);
    barrier.resolve();
    await until(() => f.released.has("progress"));
    assert.ok(f.results.has("progress"));
  } finally {
    barrier.resolve();
    await until(() => f.released.has("progress"));
    await f.supervisor.close();
  }
});

test("消息保留 Task/Caller 归属，Never 在投递前明确拒绝", async () => {
  const f = fixture(true);
  try {
    await f.supervisor.run("messages", { kind: "message" }, "scope");
    f.supervisor.message("messages", {
      messageId: "id",
      taskId: "task",
      caller: { scope: "scope", subject: "subject" },
      payload: { contribution: 1 },
    });
    await until(() => f.released.has("messages"));
    assert.deepEqual(f.confirmations, [{ runId: "messages", taskId: "task", messageId: "id" }]);
    assert.deepEqual(f.results.get("messages"), {
      messageId: "id",
      taskId: "task",
      caller: { scope: "scope", subject: "subject" },
      payload: { contribution: 1 },
    });
    assert.throws(
      () =>
        f.supervisor.message("messages", {
          messageId: "late",
          taskId: "task",
          caller: { scope: "scope", subject: "subject" },
          payload: {},
        }),
      { code: "no_run_route" },
    );
  } finally {
    await f.supervisor.close();
  }
  const never = fixture();
  try {
    await never.supervisor.run("never", { kind: "wait" }, "scope");
    await until(() => never.progress.length > 0);
    for (const payload of [{}, null])
      assert.throws(
        () =>
          never.supervisor.message("never", {
            messageId: "id",
            taskId: "task",
            caller: { scope: "scope", subject: "subject" },
            payload,
          }),
        { code: "invalid_input" },
      );
    never.supervisor.cancel("never");
    await until(() => never.released.has("never"));
  } finally {
    await never.supervisor.close();
  }
});

test("宿主存储拒绝进度会拒绝上报，不返回业务成功", async () => {
  const f = fixture();
  f.channel.progress = async () => {
    throw new Error("存储拒绝");
  };
  try {
    await f.supervisor.run("rejected", {}, "scope");
    await until(() => f.released.has("rejected"));
    assert.equal(f.results.size, 0);
    assert.equal(f.failures.get("rejected"), "type_channel_failure");
  } finally {
    await f.supervisor.close();
  }
});

test("卡死的类型不会卡死宿主，健康恢复不自动重跑旧 Run", async () => {
  const f = fixture();
  const supervisor = new TypeSupervisor(f.registration, f.channel, {
    heartbeatMs: 20,
    healthMs: 1000,
    maxInFlight: 8,
    maxPayloadBytes: 65_536,
  });
  try {
    await supervisor.run("blocked", { kind: "block" }, "scope");
    await delay(30);
    let responsive = false;
    await new Promise<void>((resolve) =>
      setImmediate(() => {
        responsive = true;
        resolve();
      }),
    );
    assert.equal(responsive, true);
    assert.deepEqual(await f.loss.promise, ["blocked"]);
    assert.equal(f.results.has("blocked"), false);
    assert.equal(f.released.has("blocked"), false);
    await supervisor.run("fresh", {}, "scope");
    await until(() => f.released.has("fresh"));
    assert.equal(f.results.has("blocked"), false);
    assert.ok(f.results.has("fresh"));
  } finally {
    await supervisor.close();
  }
});
