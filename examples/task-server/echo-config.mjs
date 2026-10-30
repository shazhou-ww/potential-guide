import { createExecutorPool } from "@potential-guide/task-engine/pool";
import { json, TaskError } from "@potential-guide/task-protocol";

export default function configure() {
  const token = process.env.TASK_SERVER_TOKEN;
  if (!token) throw new Error("Set TASK_SERVER_TOKEN.");
  const pool = createExecutorPool({
    resources: ["echo"],
    resourceKey: () => "echo",
    run(input) {
      const result = Promise.resolve(input);
      return {
        result,
        exited: result.then(() => {}),
        cooperate() {},
        async force() {
          throw new Error("Same-thread example cannot force.");
        },
        async cleanup() {},
      };
    },
  });
  return {
    port: Number(process.env.TASK_SERVER_PORT ?? 3000),
    database: process.env.TASK_SERVER_DATABASE ?? "tasks.sqlite",
    types: [
      {
        type: "echo",
        version: "1",
        environment: "echo-v1",
        inputSchema: { type: "object" },
        prepare: async (value) => value,
        validatePrepared: json,
        validateResult: json,
        validateProgress: json,
        execute: (value, options) => pool.execute(value, options),
      },
    ],
    currentVersions: { echo: "1" },
    authorize: (caller, _operation, scope) =>
      caller.scope === scope && caller.subject === "example",
    resolveCaller(request) {
      if (request.headers.get("authorization") !== `Bearer ${token}`)
        throw new TaskError("unauthenticated", "Authentication required.");
      return { scope: "example", subject: "example" };
    },
    closeResources: () => pool.close(),
  };
}
