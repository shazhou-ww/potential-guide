import type { IncomingMessage, ServerResponse } from "node:http";
import type { TaskScheduler } from "./scheduler.js";
import type { Json, Subject } from "./types.js";
import { type CheckRequest, TaskProtocolError } from "./v2-types.js";

function fail(status: number, code: string, message: string): never {
  throw new TaskProtocolError(status, { code, stage: "schedule", message });
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function json(value: unknown, depth = 0): value is Json {
  if (depth > 32) return false;
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value)
      ? value.every((item) => json(item, depth + 1))
      : object(value) && Object.values(value).every((item) => json(item, depth + 1)))
  );
}
function subject(value: unknown): value is Subject {
  return object(value) && json(value);
}
export function parseCheckRequest(value: unknown): CheckRequest {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) => !["check", "subject", "context", "freshness", "timeoutMs"].includes(key),
    ) ||
    !object(value.check) ||
    Object.keys(value.check).some((key) => !["url", "digest"].includes(key)) ||
    typeof value.check.url !== "string" ||
    value.check.url.length > 4096 ||
    (value.check.digest !== undefined &&
      (typeof value.check.digest !== "string" ||
        !/^sha256-pguide-check-v1:[a-f0-9]{64}$/.test(value.check.digest))) ||
    !subject(value.subject) ||
    (value.context !== undefined && !subject(value.context)) ||
    (value.freshness !== undefined &&
      value.freshness !== "started-after-request" &&
      value.freshness !== "completed-after-request") ||
    (value.timeoutMs !== undefined && typeof value.timeoutMs !== "number")
  )
    fail(
      400,
      "invalid_request",
      "Expected check.url, optional digest, JSON subject and observation options.",
    );
  return {
    check: {
      url: value.check.url,
      ...(typeof value.check.digest === "string" ? { digest: value.check.digest } : {}),
    },
    subject: value.subject,
    ...(value.context !== undefined ? { context: value.context } : {}),
    ...(value.freshness !== undefined ? { freshness: value.freshness } : {}),
    ...(value.timeoutMs !== undefined ? { timeoutMs: value.timeoutMs } : {}),
  };
}
async function body(request: IncomingMessage, limit: number): Promise<unknown> {
  if (request.headers["content-type"] !== "application/json")
    fail(400, "json_required", "JSON content required.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) fail(400, "request_too_large", "Request exceeds limit.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "invalid_json", "Invalid JSON.");
  }
}
export async function routeV2(
  scheduler: TaskScheduler,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) {
  const scope = "local-owner";
  const reply = (value: unknown, status = 200) => {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(value));
  };
  if (request.method === "GET" && url.pathname === "/v2/events") {
    if ([...url.searchParams.keys()].some((key) => key !== "taskId" && key !== "scope"))
      fail(400, "invalid_filter", "Unknown event filter.");
    const ids = url.searchParams.getAll("taskId");
    const all = url.searchParams.getAll("scope");
    if ((ids.length && all.length) || (!ids.length && (all.length !== 1 || all[0] !== "all")))
      fail(400, "invalid_filter", "Provide taskId list or explicit scope=all.");
    let blocked = false;
    // Validation/registration and initial snapshots share one synchronous arbitration boundary.
    const release = scheduler.subscribe(ids.length ? ids : undefined, scope, (event) => {
      if (blocked) {
        response.destroy();
        return;
      }
      if (!response.headersSent)
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
      blocked = !response.write(
        `id: ${event.taskId}:${event.snapshot.revision}\nevent: task.updated\ndata: ${JSON.stringify(event)}\n\n`,
      );
      if (blocked)
        response.once("drain", () => {
          blocked = false;
        });
    });
    if (!response.headersSent)
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    response.flushHeaders();
    const heartbeat = setInterval(() => {
      if (blocked) response.destroy();
      else blocked = !response.write(": heartbeat\n\n");
    }, 10_000);
    const lifetime = setTimeout(() => response.end(), scheduler.limits.retentionMs);
    response.once("close", () => {
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      release();
    });
    return;
  }
  if (url.search) fail(400, "invalid_query", "Query is only supported on events.");
  if (request.method === "POST" && url.pathname === "/v2/check-tasks") {
    const value = parseCheckRequest(await body(request, scheduler.kernel.limits.messageBytes));
    const key = request.headers["idempotency-key"];
    if (key !== undefined && (typeof key !== "string" || !/^[\x21-\x7e]{1,128}$/.test(key)))
      fail(400, "invalid_idempotency_key", "Invalid idempotency key.");
    const snapshot = scheduler.accept(value, scope, key);
    response.setHeader("location", `/v2/check-tasks/${snapshot.taskId}`);
    reply(snapshot, 201);
    return;
  }
  const task = /^\/v2\/check-tasks\/([a-zA-Z0-9-]{1,128})(\/cancel)?$/.exec(url.pathname);
  if (task?.[1] && request.method === "GET" && !task[2]) {
    reply(scheduler.snapshot(task[1], scope));
    return;
  }
  if (task?.[1] && request.method === "POST" && task[2]) {
    reply(scheduler.cancel(task[1], scope), 202);
    return;
  }
  if (request.method === "POST" && url.pathname === "/v2/artifacts/resolve") {
    const value = await body(request, 8192);
    if (!object(value) || Object.keys(value).join(",") !== "url" || typeof value.url !== "string")
      fail(400, "invalid_source", "Expected url.");
    reply((await scheduler.artifacts.resolve(value.url)).metadata);
    return;
  }
  const artifact = /^\/v2\/artifacts\/([^/]+)(?:\/references\/(.+))?$/.exec(url.pathname);
  if (artifact?.[1] && request.method === "GET") {
    const digest = decodeURIComponent(artifact[1]);
    if (artifact[2]) {
      const bytes = await scheduler.artifacts.reference(digest, decodeURIComponent(artifact[2]));
      response.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(bytes);
    } else reply(scheduler.artifacts.metadata(digest));
    return;
  }
  fail(404, "route_unavailable", "Unknown v2 route.");
}
