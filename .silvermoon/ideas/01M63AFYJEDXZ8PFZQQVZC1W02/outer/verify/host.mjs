import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { openSqliteStore } from "@potential-guide/task-engine-storage";
import { createTaskHandler } from "@potential-guide/task-engine-http";
import { TaskError } from "@potential-guide/task-protocol";
import { bounded, caller, harness } from "./support.mjs";

const [database, now, currentVersion = "1"] = process.argv.slice(2);
const credentials = JSON.parse(process.env.DEPLOYMENT_CREDENTIALS);
const store = openSqliteStore(database);
const h = harness({ store, now: Number(now), currentVersion, limits: { retentionMs: 5 } });
let activeStreams = 0;
const streamWaiters = [];
const handler = createTaskHandler({
  service: h.engine, prefix: "/api", pollMs: 10,
  resolveCaller(request) {
    const authorization = request.headers.get("authorization");
    const scope = authorization === `Bearer ${credentials.a}` ? "a" :
      authorization === `Bearer ${credentials.b}` ? "b" : undefined;
    if (!scope) throw new TaskError("unauthenticated", "需要本次测试凭据");
    return { ...caller, scope };
  },
});
const server = createServer(async (incoming, outgoing) => {
  const abort = new AbortController();
  incoming.once("aborted", () => abort.abort());
  outgoing.once("close", () => abort.abort());
  let sse = false;
  let reader;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 65536) throw new Error("测试请求体超限");
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers))
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const body = Buffer.concat(chunks);
    const web = new Request(`http://127.0.0.1${incoming.url}`, {
      method: incoming.method, headers, signal: abort.signal,
      ...(body.length ? { body } : {}),
    });
    const response = await handler(web);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    sse = response.headers.get("content-type") === "text/event-stream";
    if (sse) activeStreams++;
    reader = response.body?.getReader();
    if (reader) {
      while (!abort.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!outgoing.write(Buffer.from(chunk.value))) {
          await Promise.race([once(outgoing, "drain"), once(outgoing, "close")]);
        }
      }
    }
    if (!outgoing.destroyed) outgoing.end();
  } catch (error) {
    if (!outgoing.headersSent) outgoing.writeHead(500, { "content-type": "application/json" });
    if (!outgoing.destroyed) outgoing.end(JSON.stringify({ error: error.message }));
  } finally {
    await reader?.cancel().catch(() => {});
    if (sse) {
      activeStreams--;
      if (!activeStreams) for (const resolve of streamWaiters.splice(0)) resolve();
    }
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
let closing;
const close = () => closing ??= (async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await h.close();
})();
process.once("disconnect", () => { void close().catch(() => { process.exitCode = 1; }); });
process.on("message", async message => {
  if (!message || !Number.isInteger(message.id)) return;
  try {
    let result;
    if (message.action === "turn") { await h.turn(message.ms); result = { now: h.clock.now() }; }
    else if (message.action === "finish") { await h.complete(message.text, message.result); result = { completed: message.text, now: h.clock.now() }; }
    else if (message.action === "progress") {
      const work = h.works.find(item => item.input.text === message.text && !item.cleaned);
      assert.ok(work);
      work.permit.progress({ marker: message.marker });
      result = { recorded: true };
    } else if (message.action === "streamsIdle") {
      if (activeStreams) await bounded(new Promise(resolve => streamWaiters.push(resolve)), "SSE 关闭");
      result = { activeStreams };
    } else if (message.action === "collect") {
      h.engine.collect();
      result = { collected: true };
    } else if (message.action === "stats") result = {
      now: h.clock.now(), starts: h.works.map(work => ({ text: work.input.text, executionId: work.permit.executionId, cleaned: work.cleaned })),
      preparation: h.preparation, activeStreams,
    };
    else if (message.action === "close") {
      await close();
      result = { closed: true, activeStreams };
    } else throw Error("未知测试控制动作");
    process.send({ id: message.id, result }, () => {
      if (message.action === "close" && process.connected) process.disconnect();
    });
  } catch (error) {
    process.send({ id: message.id, error: { code: error.code, message: error.message } });
  }
});
process.send({
  ready: true, pid: process.pid, port: address.port, url: `http://127.0.0.1:${address.port}/api`,
  now: h.clock.now(),
  modules: ["@potential-guide/task-engine", "@potential-guide/task-engine-http", "@potential-guide/task-engine-storage"]
    .map(name => ({ name, resolved: import.meta.resolve(name) })),
});
