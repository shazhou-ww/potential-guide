import { createExecutorPool } from "@potential-guide/task-engine/pool";
import { type JsonObject, json, object, type TaskType } from "@potential-guide/task-protocol";

/** Explicit demo/test composition, never imported or started by the UI Server. */
export function fixtureTypes() {
  const pool = createExecutorPool<JsonObject>({
    resources: ["demo"],
    resourceKey: () => "demo",
    run(value, permit) {
      let finish: (value: unknown) => void = () => {};
      let exit: () => void = () => {};
      let stopped = false;
      const exited = new Promise<void>((resolve) => {
        exit = resolve;
      });
      const result = new Promise<unknown>((resolve) => {
        finish = resolve;
      });
      const duration = typeof value.durationMs === "number" ? value.durationMs : 1000;
      permit.progress({ phase: "开始", input: value });
      const progress = setInterval(
        () => permit.progress({ phase: "执行中", message: "独立模拟执行，不访问用户资源" }),
        100,
      );
      const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(progress);
        clearTimeout(timer);
        finish({ ok: false, stopped: true });
        exit();
      };
      const timer = setTimeout(() => {
        clearInterval(progress);
        stopped = true;
        finish({ ok: false, value, note: "这是正常业务否定结果，不是执行故障" });
        exit();
      }, duration);
      return {
        result,
        exited,
        cooperate: stop,
        force: async () => stop(),
        cleanup: async () => {},
      };
    },
  });
  const base = {
    version: "1",
    environment: "web-ui-fixture-v1",
    prepare: async (value: JsonObject) => value,
    validatePrepared: object,
    validateResult: json,
    validateProgress: json,
    execute: (value: JsonObject, options: Parameters<TaskType<JsonObject>["execute"]>[1]) =>
      pool.execute(value, options),
  };
  const types: TaskType<JsonObject>[] = [
    {
      ...base,
      type: "echo",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: { type: "string", minLength: 1, title: "消息" },
          durationMs: { type: "integer", minimum: 1, maximum: 60000 },
          metadata: { type: "object", title: "自由对象" },
        },
      },
    },
    {
      ...base,
      type: "survey",
      inputSchema: {
        type: "object",
        required: ["subject", "scores"],
        additionalProperties: false,
        $defs: {
          subject: {
            type: "object",
            required: ["name", "active"],
            additionalProperties: false,
            properties: { name: { type: "string" }, active: { type: "boolean" } },
          },
        },
        properties: {
          subject: { $ref: "#/$defs/subject" },
          scores: { type: "array", items: { type: "number" } },
          mode: { type: "string", enum: ["brief", "full"] },
          durationMs: { type: "integer", minimum: 1, maximum: 60000 },
        },
      },
    },
  ];
  return { types, close: () => pool.close() };
}
