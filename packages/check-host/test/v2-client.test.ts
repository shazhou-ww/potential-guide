import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { CheckTask, CheckTaskClient } from "../dist/index.js";

test("SDK rejects incomplete completed evidence and invalid UTF-8 References without creating or cancelling Tasks", async () => {
  const methods: string[] = [];
  const server = createServer((request, response) => {
    methods.push(request.method ?? "");
    assert.equal(request.headers.authorization, "Bearer fixture-token");
    if (request.url?.startsWith("/v2/events?")) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `event: task.updated\ndata: ${JSON.stringify({
          taskId: "known",
          snapshot: {
            taskId: "known",
            hostInstance: "fixture",
            revision: 1,
            state: "completed",
            freshness: "started-after-request",
            acceptedAt: "2026-10-28T10:00:00.000Z",
            result: { ok: false },
          },
        })}\n\n`,
      );
    } else {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end(Buffer.from([0xff]));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new CheckTaskClient({
    endpoint: `http://127.0.0.1:${address.port}`,
    token: "fixture-token",
    instance: "fixture",
    pid: process.pid,
  });
  try {
    await assert.rejects(new CheckTask("known", client).result(), /evidence is incomplete/);
    await assert.rejects(client.reference("digest", "check"), TypeError);
    assert.ok(methods.length >= 2 && methods.every((method) => method === "GET"));
  } finally {
    client.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
