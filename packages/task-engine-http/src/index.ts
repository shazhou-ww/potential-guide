import {
  type Caller,
  fail,
  type HistoryFilter,
  type Observation,
  object,
  positive,
  type Subscription,
  TaskError,
  type TaskQuery,
  type TaskService,
  ulid,
} from "@potential-guide/task-protocol";

export interface HandlerOptions {
  service: TaskService;
  resolveCaller(request: Request): Caller | Promise<Caller>;
  prefix?: string;
  maxBodyBytes?: number;
  pollMs?: number;
  maxConcurrentRequests?: number;
  auditRejection?: (event: { requestId?: string; code: string }) => void;
}
function status(code: string): number {
  if (code === "unauthenticated") return 401;
  if (code === "forbidden") return 403;
  if (code === "contract_revision_mismatch") return 412;
  if (code === "not_found") return 404;
  if (code === "history_expired" || code === "query_expired") return 410;
  if (code === "idempotency_conflict" || code === "task_finished") return 409;
  if (code === "payload_too_large") return 413;
  if (code === "capacity_exceeded") return 429;
  if (
    [
      "engine_closed",
      "store_owned",
      "unsupported_version",
      "unsupported_contract",
      "unsupported_environment",
    ].includes(code)
  )
    return 503;
  if (code.startsWith("invalid_") || code === "unknown_type") return 400;
  return 500;
}
function response(value: unknown, code = 200): Response {
  return new Response(JSON.stringify(value), {
    status: code,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
async function body(request: Request, limit: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    fail("invalid_request", "Content-Type application/json is required.");
  if (Number(request.headers.get("content-length")) > limit)
    fail("payload_too_large", "Body too large.");
  const reader = request.body?.getReader();
  if (!reader) fail("invalid_request", "JSON body required.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        fail("payload_too_large", "Body too large.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(merged));
  } catch {
    fail("invalid_request", "Malformed JSON body.");
  }
}
function filter(url: URL): HistoryFilter {
  const entries = [...url.searchParams].filter(([key]) =>
    ["taskId", "executionId", "seriesId"].includes(key),
  );
  if (entries.length !== 1) fail("invalid_request", "Exactly one history filter required.");
  return Object.fromEntries(entries) as HistoryFilter;
}
function frame(observation: Observation): Uint8Array {
  return new TextEncoder().encode(
    `id: ${observation.cursor}\nevent: task.observation\ndata: ${JSON.stringify(observation)}\n\n`,
  );
}
function stream(subscription: Subscription, signal: AbortSignal, pollMs: number): Response {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  let closed = false;
  let first = true;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const close = () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    wake?.();
    subscription.close();
    signal.removeEventListener("abort", abort);
  };
  const abort = () => {
    close();
    controller?.close();
  };
  const readable = new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value;
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      },
      async pull(value) {
        if (closed) return;
        if (!first)
          await new Promise<void>((resolve) => {
            wake = resolve;
            timer = setTimeout(resolve, pollMs);
          });
        if (closed) return;
        try {
          const observation = first ? subscription.initial : subscription.pull();
          first = false;
          value.enqueue(frame(observation));
        } catch (error) {
          close();
          value.error(error);
        }
      },
      cancel: close,
    },
    { highWaterMark: 1 },
  );
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export function createTaskHandler(
  options: HandlerOptions,
): (request: Request) => Promise<Response> {
  const prefix = options.prefix ?? "";
  if (prefix && (!prefix.startsWith("/") || prefix.endsWith("/")))
    fail("invalid_request", "Invalid mount prefix.");
  const maxBody = positive(options.maxBodyBytes ?? 65_536, "maxBodyBytes");
  const pollMs = positive(options.pollMs ?? 100, "pollMs");
  const maxConcurrent = positive(options.maxConcurrentRequests ?? 128, "maxConcurrentRequests");
  let active = 0;
  return async (request) => {
    let identity: string | undefined;
    let counted = false;
    try {
      if (active >= maxConcurrent) fail("capacity_exceeded", "HTTP concurrency limit.");
      active++;
      counted = true;
      const caller = await options.resolveCaller(request);
      const url = new URL(request.url);
      if (prefix && !url.pathname.startsWith(`${prefix}/`)) fail("not_found", "Route not found.");
      const path = url.pathname.slice(prefix.length);
      if (request.method === "GET" && path === "/task-types")
        return response(options.service.discoverTypes(caller));
      if (request.method === "GET" && path === "/tasks") {
        const query: Record<string, string> = {};
        const allowed = new Set([
          "type",
          "createdFrom",
          "createdBefore",
          "updatedFrom",
          "updatedBefore",
          "sort",
          "cursor",
          "limit",
        ]);
        for (const [key, value] of url.searchParams) {
          if (!allowed.has(key) || key in query)
            fail("invalid_request", "Unknown or duplicate Task query parameter.");
          query[key] = value;
        }
        const { cursor, limit, ...filters } = query;
        if (limit !== undefined && !/^[1-9][0-9]*$/.test(limit))
          fail("invalid_request", "limit must be a positive integer.");
        return response(
          options.service.listTasks(
            filters as TaskQuery,
            {
              ...(cursor !== undefined ? { cursor } : {}),
              ...(limit !== undefined ? { limit: Number(limit) } : {}),
            },
            caller,
          ),
        );
      }
      if (request.method === "POST" && path === "/tasks") {
        identity = ulid(request.headers.get("Idempotency-Key"));
        const raw = object(await body(request, maxBody));
        if ("requestId" in raw) fail("invalid_request", "requestId belongs in Idempotency-Key.");
        const match = request.headers.get("If-Match");
        if (match !== null && !/^"[a-f0-9]{64}"$/.test(match))
          fail("invalid_request", "If-Match must contain one quoted contract revision.");
        return response(
          options.service.submit(
            { ...raw, requestId: identity },
            caller,
            match === null ? {} : { expectedRevision: match.slice(1, -1) },
          ),
          202,
        );
      }
      const task = /^\/tasks\/([0-9A-Z]+)(\/cancel)?$/.exec(path);
      if (task?.[1] && request.method === "GET" && !task[2])
        return response(options.service.getTask(task[1], caller));
      if (task?.[1] && task[2] && request.method === "POST")
        return response(options.service.cancelTask(task[1], caller));
      const original = /^\/requests\/([0-9A-Z]+)$/.exec(path);
      if (original?.[1] && request.method === "GET")
        return response(options.service.getRequest(original[1], caller));
      if (request.method === "GET" && path === "/event-history") {
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const limit = url.searchParams.has("limit")
          ? Number(url.searchParams.get("limit"))
          : undefined;
        return response(
          options.service.readHistory(
            filter(url),
            {
              ...(cursor ? { cursor } : {}),
              ...(limit !== undefined ? { limit } : {}),
            },
            caller,
          ),
        );
      }
      if (request.method === "GET" && path === "/events")
        return stream(
          options.service.subscribe(
            filter(url),
            request.headers.get("Last-Event-ID") ?? undefined,
            caller,
          ),
          request.signal,
          pollMs,
        );
      fail("not_found", "Route not found.");
    } catch (error) {
      const code = error instanceof TaskError ? error.code : "internal_error";
      options.auditRejection?.({ ...(identity ? { requestId: identity } : {}), code });
      return response(
        {
          error: {
            code,
            message: error instanceof TaskError ? error.message : "Internal server error.",
          },
        },
        status(code),
      );
    } finally {
      if (counted) active--;
    }
  };
}
