import { TaskError } from "@potential-guide/task-protocol";

export default function configure() {
  const token = process.env.TASK_SERVER_TOKEN;
  if (!token) throw new Error("Set TASK_SERVER_TOKEN.");
  return {
    port: Number(process.env.TASK_SERVER_PORT ?? 3000),
    database: process.env.TASK_SERVER_DATABASE ?? "tasks.sqlite",
    types: [
      {
        type: "echo",
        version: "1",
        environment: "echo-v1",
        inputSchema: { type: "object" },
        resultSchema: true,
        messageSchema: false,
        module: new URL("./echo-type.mjs", import.meta.url).href,
        exportName: "createEcho",
        configuration: {},
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
  };
}
