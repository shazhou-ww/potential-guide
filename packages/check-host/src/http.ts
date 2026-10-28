import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Effect, SubscriptionRef, watchSnapshot } from "@potential-guide/effects";
import type { CheckKernel } from "./kernel.js";
import { HostError, type StartCheck, terminal } from "./types.js";
import type { TaskScheduler } from "./scheduler.js";
import { routeV2 } from "./v2-http.js";
import { TaskProtocolError } from "./v2-types.js";
import type { ServiceRouter } from "./service-http.js";

export async function serve(
  kernel: CheckKernel,
  token: string,
  scheduler?: TaskScheduler,
  modules?: { routers: readonly ServiceRouter[]; close(): Promise<void> },
) {
  let observers = 0;
  const server = createServer((request, response) => {
    void route(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(
        error instanceof HostError || error instanceof TaskProtocolError ? error.status : 500,
        {
          "content-type": "application/json",
        },
      );
      response.end(
        JSON.stringify({
          error:
            error instanceof TaskProtocolError
              ? error.detail
              : request.url?.startsWith("/v2/")
                ? {
                    code: error instanceof HostError ? `http_${error.status}` : "internal_error",
                    stage: "schedule",
                    message: error instanceof HostError ? error.message : "Host request failed.",
                  }
                : error instanceof Error
                  ? error.message
                  : String(error),
        }),
      );
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxConnections = kernel.limits.observers + 16;
  async function observe<T>(
    ref: SubscriptionRef.SubscriptionRef<T>,
    request: IncomingMessage,
    response: ServerResponse,
    complete?: (state: T) => boolean,
  ) {
    if (request.headers.accept !== "application/x-ndjson") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(Effect.runSync(SubscriptionRef.get(ref))));
      return;
    }
    if (observers >= kernel.limits.observers)
      throw new HostError(429, "Observer capacity exhausted.");
    observers++;
    response.writeHead(200, {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    });
    const lifetime = new AbortController();
    let blocked = false;
    const watcher = watchSnapshot(
      ref,
      (state) => {
        if (blocked) {
          response.destroy();
          return;
        }
        const writable = response.write(`${JSON.stringify(state)}\n`);
        if (complete?.(state)) response.end();
        else if (!writable) {
          // One bounded frame may drain; never queue subsequent snapshots behind it.
          blocked = true;
          response.once("drain", () => {
            blocked = false;
          });
        }
      },
      lifetime.signal,
    );
    const timer = setTimeout(() => response.end(), kernel.limits.retentionMs);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      lifetime.abort();
      observers--;
      void watcher.exit();
    };
    response.once("close", release);
    response.once("finish", release);
  }
  async function route(request: IncomingMessage, response: ServerResponse) {
    const supplied = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      throw new HostError(401, "Authentication required.");
    if (request.headers.origin !== undefined)
      throw new HostError(403, "Browser origins are unsupported.");
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    for (const router of modules?.routers ?? [])
      if (await router(request, response, "local-owner")) return;
    if (url.pathname.startsWith("/v2/") && scheduler) {
      await routeV2(scheduler, request, response, url);
      return;
    }
    if (url.search) throw new HostError(400, "Query parameters are unsupported.");
    if (request.method === "GET" && url.pathname === "/checks") {
      await observe(kernel.active, request, response);
      return;
    }
    const match = /^\/checks\/([A-Za-z0-9:_-]{1,128})(\/cancel)?$/.exec(
      decodeURIComponent(url.pathname),
    );
    if (match?.[1] && kernel.isManaged(match[1]))
      throw new HostError(404, "Unknown or expired checkId.");
    if (request.method === "GET" && match?.[1] && !match[2]) {
      await observe(kernel.observe(match[1]).state, request, response, terminal);
      return;
    }
    if (request.method === "POST" && match?.[1] && match[2]) {
      const state = kernel.cancel(match[1]);
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify(state));
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/checks")
      throw new HostError(404, "Unknown route.");
    if (request.headers["content-type"] !== "application/json")
      throw new HostError(415, "JSON required.");
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > kernel.limits.messageBytes) throw new HostError(413, "Start exceeds limit.");
      chunks.push(chunk);
    }
    let value: StartCheck;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HostError(400, "Invalid JSON.");
    }
    if (
      !value ||
      Object.keys(value).some(
        (key) => !["checkId", "directory", "revision", "subject", "context"].includes(key),
      ) ||
      typeof value.checkId !== "string" ||
      typeof value.directory !== "string" ||
      typeof value.revision !== "string"
    )
      throw new HostError(
        400,
        "Expected checkId, directory, revision, subject; legacy bare subjects are unsupported.",
      );
    const execution = await kernel.executeCheck(value);
    response.writeHead(201, { "content-type": "application/json" });
    response.end(JSON.stringify({ checkId: execution.checkId }));
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Host did not bind loopback.");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    server,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await modules?.close();
      if (scheduler) await scheduler.close();
      else await kernel.close();
    },
  };
}
