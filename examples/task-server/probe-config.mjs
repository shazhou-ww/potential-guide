import { createArtifactSource, createCheckTaskType } from "@potential-guide/check-task";
import { createProbeTaskType } from "@potential-guide/probe-task";
import { TaskError } from "@potential-guide/task-protocol";

/** Trusted composition, shared by the CLI and in-process callers. */
export function composeProbeServer({ source, directory, database, token, port = 0 }) {
  let engine;
  const check = createCheckTaskType({ source, directory, workers: 1, languages: ["en"] });
  const probe = createProbeTaskType({
    source,
    checkEnvironment: check.environment,
    parents: 2,
    children(scope) {
      return {
        service: engine,
        caller: { scope, subject: "probe-child" },
        waitForTaskRelease: (id, caller) => engine.waitForTaskRelease(id, caller),
      };
    },
  });
  return {
    port,
    database,
    types: [check, probe],
    currentVersions: { check: "2", probe: "2" },
    limits: { maxConcurrent: 1, maxPayloadBytes: 16 * 1024 * 1024 },
    bindService(service) {
      engine = service;
    },
    authorize: (caller, _operation, scope) =>
      caller.scope === scope && ["example", "probe-child"].includes(caller.subject),
    resolveCaller(request) {
      if (request.headers.get("authorization") !== `Bearer ${token}`)
        throw new TaskError("unauthenticated", "Authentication required.");
      return { scope: "example", subject: "example" };
    },
    async closeResources() {
      await probe.close();
      await check.close();
      await source.close?.();
    },
  };
}

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
  return composeProbeServer({
    source,
    directory: process.env.CHECK_WORKERS ?? ".check-workers",
    database: process.env.TASK_SERVER_DATABASE ?? "tasks.sqlite",
    port: Number(process.env.TASK_SERVER_PORT ?? 3000),
    token,
  });
}
