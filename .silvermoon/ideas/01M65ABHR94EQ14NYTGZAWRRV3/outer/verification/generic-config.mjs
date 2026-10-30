import { createExecutorPool } from "@potential-guide/task-engine/pool";
import { json, canonical, TaskError } from "@potential-guide/task-protocol";
export default function configure() {
  const pool = createExecutorPool({
    resources: ["echo"], resourceKey: () => "echo",
    run(value) {
      const result = Promise.resolve(value);
      return { result, exited: result.then(() => {}), cooperate() {},
        async force() { throw Error("No force capability for same-thread work."); },
        async cleanup() {} };
    },
  });
  return {
    database: process.env.DATABASE, port: 0,
    types: [{
      type: "echo", version: "1", environment: "deployment-echo-v1",
      validate: json, equals: (a, b) => canonical(a) === canonical(json(b)),
      prepare: async (value) => value, validatePrepared: json,
      validateResult: json, validateProgress: json,
      execute: (value, options) => pool.execute(value, options),
    }],
    currentVersions: { echo: "1" },
    authorize: (caller, _operation, scope) => caller.scope === scope,
    resolveCaller(request) {
      if (request.headers.get("authorization") !== "Bearer operator")
        throw new TaskError("unauthenticated", "Authentication required.");
      return { scope: "one", subject: "operator" };
    },
    closeResources: () => pool.close(),
  };
}
