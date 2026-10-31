import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFiniteJson } from "./json.js";

export interface EndpointConfig {
  id: string;
  label: string;
  url: string;
  /** Change when reassigning the ID to a different logical service/scope. */
  binding: string;
  bearerEnv?: string;
}
export interface UiConfig {
  endpoints: EndpointConfig[];
  host?: string;
  port?: number;
  favoritesFile: string;
}
export interface Endpoint {
  id: string;
  label: string;
  binding: string;
}
export interface Favorite {
  id: string;
  name: string;
  endpoint: Endpoint;
  parameters: Record<string, unknown>;
}
const BODY_LIMIT = 65_536;
const RESPONSE_LIMIT = 2_097_152;
const FAVORITES_LIMIT = 4_194_304;
const MAX_ACTIVE = 32;
const MAX_STREAMS = 8;
const REQUEST_MS = 15_000;
const STREAM_MS = 60_000;
const STREAM_BYTES = 8_388_608;
const idPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const safeName = /^[a-zA-Z0-9_-]{1,64}$/;
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
function reject(status: number, code: string, message: string): never {
  throw new HttpError(status, code, message);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object")
    reject(400, "invalid_request", "需要 JSON 对象。");
  return value as Record<string, unknown>;
}
function same(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function redactCredential(value: unknown, token: string): unknown {
  if (typeof value === "string") return value.split(token).join("[redacted]");
  if (Array.isArray(value)) return value.map((item) => redactCredential(item, token));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.split(token).join("[redacted]"),
        redactCredential(item, token),
      ]),
    );
  return value;
}
export function publicEndpoint(config: EndpointConfig): Endpoint {
  return {
    id: config.id,
    label: config.label,
    binding: createHash("sha256")
      .update(JSON.stringify([config.id, config.url, config.binding, config.bearerEnv ?? null]))
      .digest("hex"),
  };
}
function validateConfig(config: UiConfig): void {
  if (!["127.0.0.1", "::1"].includes(config.host ?? "127.0.0.1"))
    throw new Error("UI 仅支持 loopback；未配置远程用户访问控制，拒绝公开监听。");
  if (
    !Number.isInteger(config.port ?? 4310) ||
    (config.port ?? 4310) < 0 ||
    (config.port ?? 4310) > 65535 ||
    !config.favoritesFile ||
    !Array.isArray(config.endpoints) ||
    config.endpoints.length > 32
  )
    throw new Error("无效 UI 配置。");
  const seen = new Set<string>();
  for (const endpoint of config.endpoints) {
    const url = new URL(endpoint.url);
    if (
      !safeName.test(endpoint.id) ||
      seen.has(endpoint.id) ||
      typeof endpoint.label !== "string" ||
      endpoint.label.length > 128 ||
      !endpoint.binding ||
      !["http:", "https:"].includes(url.protocol) ||
      (url.protocol === "http:" && !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (endpoint.bearerEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(endpoint.bearerEnv))
    )
      throw new Error("Endpoint 配置无效：只允许 HTTPS 或 loopback HTTP，禁止 URL 凭据。");
    seen.add(endpoint.id);
  }
}
async function incomingBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"] !== "application/json")
    reject(415, "invalid_content_type", "需要 application/json。");
  const chunks: Buffer[] = [];
  let bytes = 0;
  if (Number(request.headers["content-length"]) > BODY_LIMIT)
    reject(413, "payload_too_large", "请求超过 64 KiB。");
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > BODY_LIMIT) reject(413, "payload_too_large", "请求超过 64 KiB。");
    chunks.push(chunk);
  }
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
    assertFiniteJson(value);
    return value;
  } catch {
    return reject(400, "invalid_json", "JSON 无效。");
  }
}
async function boundedBody(response: Response, max = RESPONSE_LIMIT): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) reject(502, "response_too_large", "后端响应超出 UI 上限。");
      parts.push(value);
    }
    return Buffer.concat(parts);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function allowedRoute(path: string, method: string, params: URLSearchParams): boolean {
  let keys: string[] = [];
  if (path === "/tasks" && method === "GET")
    keys = ["type", "createdFrom", "createdBefore", "sort", "cursor", "limit"];
  else if (["/event-history", "/events"].includes(path) && method === "GET")
    keys = [
      "taskId",
      "executionId",
      "seriesId",
      ...(path === "/event-history" ? ["cursor", "limit"] : []),
    ];
  else if (
    !(
      (path === "/task-types" && method === "GET") ||
      (path === "/tasks" && method === "POST") ||
      (new RegExp(`^/(tasks|requests)/${idPattern.source.slice(1, -1)}$`).test(path) &&
        method === "GET") ||
      (new RegExp(`^/tasks/${idPattern.source.slice(1, -1)}/cancel$`).test(path) &&
        method === "POST")
    )
  )
    return false;
  const seen = new Set<string>();
  for (const [key, value] of params) {
    if (!keys.includes(key) || seen.has(key) || value.length > 8192) return false;
    seen.add(key);
  }
  return true;
}

export async function startUiServer(raw: UiConfig) {
  const config = structuredClone(raw);
  validateConfig(config);
  const endpoints = new Map(
    config.endpoints.map((entry) => {
      const token = entry.bearerEnv ? process.env[entry.bearerEnv] : undefined;
      if (entry.bearerEnv && (!token || /[\r\n]/.test(token)))
        throw new Error(`Endpoint ${entry.id} 的凭据环境变量缺失或无效。`);
      return [entry.id, { config: entry, public: publicEndpoint(entry), token }];
    }),
  );
  const csrf = randomBytes(32).toString("hex");
  const favoritePath = resolve(config.favoritesFile);
  let favorites: Favorite[] = [];
  try {
    const saved = await readFile(favoritePath);
    if (saved.byteLength > FAVORITES_LIMIT) throw new Error("收藏文件超出上限。");
    const parsed: unknown = JSON.parse(saved.toString("utf8"));
    assertFiniteJson(parsed);
    if (!Array.isArray(parsed) || parsed.length > 200) throw new Error("收藏文件格式无效。");
    for (const item of parsed) {
      const entry = record(item);
      if (
        typeof entry.id !== "string" ||
        typeof entry.name !== "string" ||
        typeof record(entry.endpoint).binding !== "string" ||
        typeof record(entry.endpoint).id !== "string"
      )
        throw new Error("收藏文件格式无效。");
      record(entry.parameters);
    }
    favorites = parsed as Favorite[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let writeQueue = Promise.resolve();
  const save = (update: (current: Favorite[]) => Favorite[]) => {
    const operation = writeQueue.then(async () => {
      const next = update(favorites);
      const content = JSON.stringify(next);
      if (next.length > 200 || Buffer.byteLength(content) > FAVORITES_LIMIT)
        reject(413, "favorites_full", "收藏上限为 200 条 / 4 MiB。");
      await mkdir(dirname(favoritePath), { recursive: true });
      const staging = `${favoritePath}.${randomUUID()}.pending`;
      try {
        await writeFile(staging, content, { mode: 0o600, flag: "wx" });
        await rename(staging, favoritePath);
      } finally {
        await rm(staging, { force: true });
      }
      favorites = next;
    });
    writeQueue = operation.catch(() => {});
    return operation;
  };
  let origin = "";
  let closing = false;
  let active = 0;
  let streams = 0;
  const controllers = new Set<AbortController>();
  const pending = new Set<Promise<void>>();
  const publicDir = fileURLToPath(
    new URL(import.meta.url.endsWith(".ts") ? "../dist/public/" : "../public/", import.meta.url),
  );
  const assets = new Map<string, { bytes: Buffer; type: string }>();
  for (const [path, name, type] of [
    ["/", "index.html", "text/html; charset=utf-8"],
    ["/app.js", "app.js", "text/javascript; charset=utf-8"],
    ["/style.css", "style.css", "text/css; charset=utf-8"],
  ] as const)
    assets.set(path, { bytes: await readFile(resolve(publicDir, name)), type });
  const server = createServer({ maxHeaderSize: 16_384 });
  server.requestTimeout = REQUEST_MS;
  server.headersTimeout = REQUEST_MS;
  server.timeout = STREAM_MS + 5_000;
  server.maxConnections = 64;
  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
  };
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const controller = new AbortController();
    let counted = false;
    let streaming = false;
    let streamCounted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => controller.abort();
    res.on("close", abort);
    controllers.add(controller);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    try {
      if (closing) reject(503, "ui_closing", "UI 正在关闭。");
      if (req.headers.host !== new URL(origin).host) reject(403, "host_denied", "Host 不匹配。");
      if (req.headers.origin && req.headers.origin !== origin)
        reject(403, "origin_denied", "Origin 不匹配。");
      if (
        req.headers["sec-fetch-site"] &&
        !["same-origin", "none"].includes(String(req.headers["sec-fetch-site"]))
      )
        reject(403, "cross_site_denied", "拒绝跨站请求。");
      if (!req.url?.startsWith("/") || req.url.startsWith("//") || req.url.includes("\\"))
        reject(400, "invalid_path", "路径无效。");
      const url = new URL(req.url, origin);
      const method = req.method ?? "GET";
      if (active >= MAX_ACTIVE) reject(429, "ui_capacity", "UI 并发上限。");
      active++;
      counted = true;
      timer = setTimeout(abort, REQUEST_MS);
      const asset = assets.get(url.pathname);
      if (asset && method === "GET" && !url.search) {
        res.writeHead(200, { "Content-Type": asset.type });
        res.end(asset.bytes);
        return;
      }
      if (url.pathname === "/api/bootstrap" && method === "GET" && !url.search) {
        send(res, 200, { csrf, endpoints: [...endpoints.values()].map((item) => item.public) });
        return;
      }
      if (!same(String(req.headers["x-ui-token"] ?? ""), csrf))
        reject(403, "csrf_denied", "UI 会话已失效；请刷新页面。");
      if (method !== "GET" && req.headers.origin !== origin)
        reject(403, "origin_required", "修改请求需要同源 Origin。");
      if (url.pathname === "/api/favorites" && !url.search) {
        if (method === "GET") {
          send(res, 200, favorites);
          return;
        }
        if (method === "POST") {
          const body = record(await incomingBody(req));
          const endpoint = endpoints.get(String(record(body.endpoint).id));
          if (!endpoint || record(body.endpoint).binding !== endpoint.public.binding)
            reject(409, "endpoint_changed", "收藏目标缺失或重新绑定，不能静默改投。");
          const parameters = record(body.parameters);
          if ("requestId" in parameters || typeof parameters.type !== "string")
            reject(400, "invalid_parameters", "收藏应为去掉生成身份的原参数。");
          if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 128)
            reject(400, "invalid_name", "收藏名称为 1–128 字符。");
          const favorite: Favorite = {
            id: randomUUID(),
            name: body.name,
            endpoint: endpoint.public,
            parameters,
          };
          await save((items) => [...items, favorite]);
          send(res, 201, favorite);
          return;
        }
      }
      const deletion = /^\/api\/favorites\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (deletion && method === "DELETE" && !url.search) {
        await save((items) => items.filter((item) => item.id !== deletion[1]));
        send(res, 200, { deleted: true });
        return;
      }
      const route = /^\/api\/endpoints\/([a-zA-Z0-9_-]{1,64})(\/.*)$/.exec(url.pathname);
      if (!route?.[1] || !route[2] || !allowedRoute(route[2], method, url.searchParams))
        reject(404, "route_denied", "不支持的路径、方法或查询参数。");
      const endpoint = endpoints.get(route[1]);
      if (!endpoint || req.headers["x-endpoint-binding"] !== endpoint.public.binding)
        reject(409, "endpoint_changed", "目标缺失或重新绑定；请刷新并核对目标。");
      streaming = route[2] === "/events";
      if (streaming && streams >= MAX_STREAMS) reject(429, "ui_stream_capacity", "UI 事件流上限。");
      if (streaming) {
        streams++;
        streamCounted = true;
        clearTimeout(timer);
        timer = setTimeout(abort, STREAM_MS);
      }
      const headers = new Headers({ Accept: streaming ? "text/event-stream" : "application/json" });
      if (endpoint.token) headers.set("Authorization", `Bearer ${endpoint.token}`);
      let payload: string | undefined;
      if (method === "POST" && route[2] === "/tasks") {
        const key = String(req.headers["idempotency-key"] ?? "");
        const match = String(req.headers["if-match"] ?? "");
        if (!idPattern.test(key) || !/^"[a-f0-9]{64}"$/.test(match))
          reject(400, "identity_required", "提交需要 ULID 与带引号的发现 revision。");
        headers.set("Idempotency-Key", key);
        headers.set("If-Match", match);
        headers.set("Content-Type", "application/json");
        const body = record(await incomingBody(req));
        if ("requestId" in body) reject(400, "invalid_request", "requestId 只能在请求头中。");
        payload = JSON.stringify(body);
      } else if (
        method === "POST" &&
        ((req.headers["content-length"] !== "0" && req.headers["content-length"] !== undefined) ||
          req.headers["transfer-encoding"])
      )
        reject(400, "unexpected_body", "取消接口不接收请求体。");
      if (streaming && req.headers["last-event-id"])
        headers.set("Last-Event-ID", String(req.headers["last-event-id"]));
      const target = `${endpoint.config.url.replace(/\/$/, "")}${route[2]}${url.search}`;
      const upstream = await fetch(target, {
        method,
        headers,
        redirect: "manual",
        signal: controller.signal,
        ...(payload !== undefined ? { body: payload } : {}),
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel();
        reject(502, "redirect_denied", "后端重定向被拒绝。");
      }
      if (!streaming || !upstream.ok) {
        const bytes = await boundedBody(upstream);
        let value: unknown;
        try {
          value = JSON.parse(Buffer.from(bytes).toString("utf8"));
          assertFiniteJson(value);
        } catch {
          reject(502, "invalid_backend_response", "后端未返回 JSON。");
        }
        // Never return credential-bearing transport errors from a trusted backend.
        if (!upstream.ok && endpoint.token) value = redactCredential(value, endpoint.token);
        send(res, upstream.status, value);
        return;
      }
      if (!upstream.headers.get("content-type")?.startsWith("text/event-stream")) {
        await upstream.body?.cancel();
        reject(502, "invalid_stream", "后端未返回 SSE。");
      }
      res.writeHead(200, { "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" });
      const reader = upstream.body?.getReader();
      if (!reader) reject(502, "invalid_stream", "缺少事件流。");
      let bytes = 0;
      try {
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > STREAM_BYTES) break;
          if (!res.write(chunk.value)) {
            await new Promise<void>((resolveDrain) => {
              const finish = () => {
                res.off("drain", finish);
                controller.signal.removeEventListener("abort", finish);
                resolveDrain();
              };
              res.once("drain", finish);
              controller.signal.addEventListener("abort", finish, { once: true });
              if (controller.signal.aborted) finish();
            });
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      res.end();
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        const known = error instanceof HttpError;
        send(res, known ? error.status : 502, {
          error: {
            code: known ? error.code : "transport_unknown",
            message: known
              ? error.message
              : "连接中断或超时；修改请求的结果可能未知，请保留原身份核对。",
          },
        });
      } else res.destroy();
    } finally {
      clearTimeout(timer);
      controller.abort();
      controllers.delete(controller);
      res.off("close", abort);
      if (counted) active--;
      if (streamCounted) streams--;
    }
  };
  server.on("request", (req, res) => {
    const operation = handle(req, res);
    pending.add(operation);
    void operation.finally(() => pending.delete(operation));
  });
  await new Promise<void>((accept, fail) => {
    server.once("error", fail);
    server.listen(config.port ?? 4310, config.host ?? "127.0.0.1", () => {
      server.off("error", fail);
      accept();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("UI listener unavailable.");
  origin = `http://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`;
  let closed: Promise<void> | undefined;
  return {
    url: origin,
    close() {
      closed ??= (async () => {
        closing = true;
        for (const controller of controllers) controller.abort();
        const stopped = new Promise<void>((accept, fail) =>
          server.close((error) => (error ? fail(error) : accept())),
        );
        server.closeAllConnections();
        await stopped;
        await Promise.all([...pending]);
        await writeQueue;
      })();
      return closed;
    },
  };
}
