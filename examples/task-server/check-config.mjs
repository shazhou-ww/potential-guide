import { createArtifactSource, createCheckTaskType } from "@potential-guide/check-task";
import { TaskError } from "@potential-guide/task-protocol";

export default function configure() {
  const token = process.env.TASK_SERVER_TOKEN;
  const origin = process.env.CHECK_ORIGIN;
  if (!token || !origin) throw new Error("Set TASK_SERVER_TOKEN and CHECK_ORIGIN.");
  const source = createArtifactSource({
    allowedOrigins: [origin],
    authorize(_reference, scope) {
      if (scope !== "example") throw new TaskError("forbidden", "Source scope denied.");
    },
  });
  const check = createCheckTaskType({
    source,
    directory: process.env.CHECK_WORKERS ?? ".check-workers",
    workers: 2,
    environment: {},
    languages: ["en"],
  });
  return {
    port: Number(process.env.TASK_SERVER_PORT ?? 3000),
    database: process.env.TASK_SERVER_DATABASE ?? "tasks.sqlite",
    types: [check],
    currentVersions: { check: "1" },
    limits: { maxPayloadBytes: 8 * 1024 * 1024 },
    authorize: (caller, _operation, scope) =>
      caller.scope === scope && caller.subject === "example",
    resolveCaller(request) {
      if (request.headers.get("authorization") !== `Bearer ${token}`)
        throw new TaskError("unauthenticated", "Authentication required.");
      return { scope: "example", subject: "example" };
    },
    async closeResources() {
      await check.close();
      await source.close();
    },
  };
}
