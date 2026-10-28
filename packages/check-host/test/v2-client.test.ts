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

test("SDK validates subject and context before serialization without invoking getters or toJSON", async () => {
  const bodies: unknown[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          taskId: `accepted-${bodies.length}`,
          hostInstance: "fixture",
          revision: 1,
          state: "accepted",
          freshness: "started-after-request",
          acceptedAt: "2026-10-28T12:30:00.000Z",
        }),
      );
    });
  });
  let requests = 0;
  server.on("request", () => {
    requests++;
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
  const check = { url: "https://example.test/check.tgz" };
  let invoked = 0;
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const getter = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      invoked++;
      return 1;
    },
  });
  const toJSON = {
    toJSON() {
      invoked++;
      return { value: 1 };
    },
  };
  const sparse = [1, 2];
  delete sparse[0];
  const invalid = [
    { value: NaN },
    { value: Infinity },
    new Date(),
    { value: new Date() },
    toJSON,
    { value: undefined },
    cycle,
    getter,
    { value: sparse },
    { value: new Map() },
  ];
  try {
    for (const value of invalid) {
      await assert.rejects(
        () => Reflect.apply(client.check, client, [{ check, subject: value }]),
        TypeError,
      );
      await assert.rejects(
        () => Reflect.apply(client.check, client, [{ check, subject: {}, context: value }]),
        TypeError,
      );
    }
    for (const field of ["subject", "context"]) {
      const request = Object.defineProperty({ check, subject: {} }, field, {
        enumerable: true,
        get() {
          invoked++;
          return {};
        },
      });
      await assert.rejects(() => Reflect.apply(client.check, client, [request]), TypeError);
    }
    assert.equal(invoked, 0);
    assert.equal(requests, 0);
    assert.deepEqual(bodies, []);

    const subject = { value: null, nested: { ok: true }, values: [null, 1, "1"] };
    const first = await client.check({ check, subject });
    assert.equal(first.taskId, "accepted-1");
    await client.check({ check, subject, context: { value: null, scope: "read" } });
    await Reflect.apply(client.check, client, [
      {
        check: { ...check, digest: undefined },
        subject,
        context: undefined,
        freshness: undefined,
        timeoutMs: undefined,
      },
    ]);
    assert.equal(requests, 3);
    assert.deepEqual(bodies, [
      { check, subject },
      { check, subject, context: { value: null, scope: "read" } },
      { check, subject },
    ]);
  } finally {
    client.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
