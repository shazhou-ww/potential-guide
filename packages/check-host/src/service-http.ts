import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  finiteJson,
  type ArtifactReference,
  type ArtifactPage,
} from "@potential-guide/check-artifacts";
import type { ContractRepository } from "./contract-store.js";
import type { ServiceEvent, ServiceSnapshot, TaskOptions } from "./task-service.js";
import { TaskProtocolError } from "./v2-types.js";

export type ServiceRouter = (
  request: IncomingMessage,
  response: ServerResponse,
  scope: string,
) => Promise<boolean>;
export interface RoutableService<Q, R, P, E> {
  limits: { filterTasks: number; retentionMs: number };
  repository: ContractRepository;
  accept(request: Q, scope: string, key?: string): ServiceSnapshot<R, P, E>;
  snapshot(id: string, scope: string): ServiceSnapshot<R, P, E>;
  cancel(id: string, scope: string): ServiceSnapshot<R, P, E>;
  subscribe(
    ids: readonly string[] | undefined,
    scope: string,
    send: (event: ServiceEvent<R, P, E>) => void,
  ): () => unknown;
  reference(digest: string, id: string, scope: string, language?: string): Promise<ArtifactPage>;
}
function fail(status: number, code: string, message: string): never {
  throw new TaskProtocolError(status, { code, stage: "validate", message });
}
async function body(request: IncomingMessage) {
  if (request.headers["content-type"] !== "application/json")
    fail(400, "json_required", "JSON body required.");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) fail(413, "request_too_large", "Request exceeds bounds.");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    ) as unknown;
  } catch {
    fail(400, "invalid_json", "Invalid JSON body.");
  }
}
/** Mounting and authorization are owned by the caller, not by the module. */
export function createServiceRouter<Q extends TaskOptions, R, P, E>(
  service: RoutableService<Q, R, P, E>,
  prefix: string,
  kind: ArtifactReference["kind"],
): ServiceRouter {
  if (!/^\/[a-zA-Z0-9/-]+$/.test(prefix) || prefix.endsWith("/"))
    throw new Error("Invalid mount prefix.");
  const tasks = kind === "objective" ? "/probe-tasks" : "/check-tasks";
  return async (request, response, scope) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith(`${prefix}/`)) return false;
    const path = url.pathname.slice(prefix.length);
    const reply = (value: unknown, status = 200) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(value));
    };
    if (request.method === "GET" && path === "/events") {
      if ([...url.searchParams.keys()].some((key) => !["taskId", "scope"].includes(key)))
        fail(400, "invalid_filter", "Unknown event filter.");
      const ids = url.searchParams.getAll("taskId");
      const all = url.searchParams.getAll("scope");
      if (ids.length ? all.length : all.length !== 1 || all[0] !== "all")
        fail(400, "invalid_filter", "Provide task IDs or explicit scope=all.");
      const pending = new Map<string, ServiceEvent<R, P, E>>();
      let blocked = false;
      let scheduled = false;
      const flush = () => {
        scheduled = false;
        if (blocked || response.destroyed) return;
        for (const [id, event] of pending) {
          pending.delete(id);
          if (
            !response.write(
              `id: ${id}:${event.snapshot.revision}\nevent: task.updated\ndata: ${JSON.stringify(event)}\n\n`,
            )
          ) {
            blocked = true;
            response.once("drain", () => {
              blocked = false;
              flush();
            });
            return;
          }
        }
      };
      const release = service.subscribe(ids.length ? ids : undefined, scope, (event) => {
        pending.set(event.taskId, event);
        if (pending.size > service.limits.filterTasks) {
          response.destroy();
          return;
        }
        if (!scheduled) {
          scheduled = true;
          setImmediate(flush);
        }
      });
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      response.flushHeaders();
      const lifetime = setTimeout(() => response.end(), service.limits.retentionMs);
      response.once("close", () => {
        clearTimeout(lifetime);
        release();
        pending.clear();
      });
      return true;
    }
    if (request.method === "POST" && path === tasks) {
      if (url.search) fail(400, "invalid_query", "Unknown query.");
      const input = await body(request);
      if (!finiteJson(input)) fail(400, "invalid_request", "Expected finite JSON.");
      const key = request.headers["idempotency-key"];
      if (key !== undefined && typeof key !== "string")
        fail(400, "invalid_idempotency_key", "Invalid idempotency key.");
      const snapshot = service.accept(input as Q, scope, key);
      response.setHeader("location", `${prefix}${tasks}/${snapshot.taskId}`);
      reply(snapshot, 201);
      return true;
    }
    const task = new RegExp(`^${tasks}/([a-zA-Z0-9-]{1,128})(/cancel)?$`).exec(path);
    if (task?.[1] && !url.search) {
      if (request.method === "GET" && !task[2]) {
        reply(service.snapshot(task[1], scope));
        return true;
      }
      if (request.method === "POST" && task[2]) {
        reply(service.cancel(task[1], scope));
        return true;
      }
    }
    if (request.method === "POST" && path === "/artifacts/resolve" && !url.search) {
      const value = await body(request);
      if (
        !value ||
        typeof value !== "object" ||
        Object.keys(value).join(",") !== "url" ||
        !("url" in value) ||
        typeof value.url !== "string"
      )
        fail(400, "invalid_source", "Expected url.");
      reply(
        (
          await service.repository.resolve(
            { kind, url: value.url },
            scope,
            AbortSignal.timeout(30_000),
          )
        ).metadata,
      );
      return true;
    }
    const artifact = /^\/artifacts\/([^/]+)(?:\/references\/([^/]+))?$/.exec(path);
    if (request.method === "GET" && artifact?.[1]) {
      const digest = decodeURIComponent(artifact[1]);
      if (artifact[2]) {
        if (
          [...url.searchParams.keys()].some((key) => key !== "language") ||
          url.searchParams.getAll("language").length > 1
        )
          fail(400, "invalid_query", "Unknown reference query.");
        reply(
          await service.reference(
            digest,
            decodeURIComponent(artifact[2]),
            scope,
            url.searchParams.get("language") ?? undefined,
          ),
        );
      } else {
        if (url.search) fail(400, "invalid_query", "Unknown artifact query.");
        reply((await service.repository.artifact(digest, scope)).metadata);
      }
      return true;
    }
    fail(404, "route_not_found", "Unknown service route.");
  };
}
/** Optional unified listener. Core services and Routers never create one. */
export async function serveServices(
  routers: readonly ServiceRouter[],
  token: string,
  close: () => Promise<void>,
) {
  if (token.length < 32) throw new Error("A private Host token is required.");
  const server = createServer((request, response) => {
    void (async () => {
      const supplied = Buffer.from(request.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        fail(401, "unauthorized", "Authentication required.");
      if (request.headers.origin !== undefined)
        fail(403, "origin_denied", "Browser origins are unsupported.");
      for (const router of routers) if (await router(request, response, "local-owner")) return;
      fail(404, "route_not_found", "Unknown service route.");
    })().catch((error) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(error instanceof TaskProtocolError ? error.status : 500, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          error:
            error instanceof TaskProtocolError
              ? error.detail
              : { code: "internal_error", stage: "observe", message: "Host request failed." },
        }),
      );
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 80;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing Host address.");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await close();
    },
  };
}
