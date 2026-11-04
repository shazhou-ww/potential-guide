import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createIpfsGatewayClient, openContent, protectContent } from "../src/index.js";
import { MemoryIpfsClient } from "../src/testing.js";

test("standalone raw Gateway preserves base paths and standard verified UnixFS/DAG limits", async (t) => {
  const memory = new MemoryIpfsClient();
  const root = await memory.import(new Map([["file", Buffer.alloc(800_000, 42)]]));
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url!);
    assert.equal(request.method, "GET");
    assert.equal(request.headers.accept, "application/vnd.ipld.raw");
    assert.equal(request.headers.authorization, undefined);
    const url = new URL(request.url!, "http://localhost");
    assert.equal(url.search, "?format=raw");
    assert.match(url.pathname, /^\/base\/ipfs\/b/);
    response.setHeader("content-type", "application/vnd.ipld.raw; version=1");
    response.end(memory.blocks.get(url.pathname.split("/").at(-1)!));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((done) => server.close(() => done())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  for (const suffix of ["/base", "/base/"]) {
    const client = createIpfsGatewayClient(`http://127.0.0.1:${address.port}${suffix}`);
    const options = { signal: new AbortController().signal };
    const entry = await openContent(client, `${root}/file`, options);
    assert.equal(entry.type, "file");
    if (entry.type !== "file") throw new Error("Expected UnixFS file.");
    const chunks: Uint8Array[] = [];
    for await (const chunk of entry.content()) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), Buffer.alloc(800_000, 42));
    await assert.rejects(protectContent(client, root, { ...options, maxDagBlocks: 1 }), /DAG/);
    await assert.rejects(
      protectContent(client, root, {
        ...options,
        protectedBlocks: new Map(),
        maxProtectedBytes: 1,
      }),
      /protection capacity/,
    );
    await assert.rejects(
      protectContent(client, root, { ...options, maxFileBytes: 1 }),
      /file capacity/,
    );
  }
  assert.ok(paths.length > 4);
});

test("Gateway rejects status, MIME, encoding, CID, declared and streamed oversize without fallback", async () => {
  const memory = new MemoryIpfsClient();
  const cid = await memory.import(new Map([["file", Buffer.from("data")]]));
  const headers = { "content-type": "application/vnd.ipld.raw" };
  for (const response of [
    () => new Response("no", { status: 404, headers }),
    () => new Response("partial", { status: 206, headers }),
    () => new Response("html", { headers: { "content-type": "text/html" } }),
    () => new Response("missing MIME"),
    () => new Response("encoded", { headers: { ...headers, "content-encoding": "gzip" } }),
    () => new Response("large", { headers: { ...headers, "content-length": "9999999" } }),
    () => new Response("wrong bytes", { headers }),
  ]) {
    let calls = 0;
    const client = createIpfsGatewayClient("https://example.test", {
      fetch: async (_url, init) => {
        calls++;
        assert.equal(init?.redirect, "error");
        assert.equal(init?.credentials, "omit");
        return response();
      },
    });
    await assert.rejects(openContent(client, cid, { signal: new AbortController().signal }));
    assert.equal(calls, 1);
  }
  let cancelled = false;
  let reads = 0;
  const client = createIpfsGatewayClient("https://example.test", {
    maxBlockBytes: 8,
    fetch: async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            reads++;
            controller.enqueue(new Uint8Array(5));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers },
      ),
  });
  await assert.rejects(client.block.get(cid), /capacity/);
  assert.ok(cancelled);
  assert.ok(reads <= 3, "Stops reading at the limit instead of buffering the body.");
  await assert.rejects(client.block.get("not-a-cid"));
  for (const url of [
    "file:///data",
    "https://user:password@example.test",
    "https://example.test/?q=1",
    "https://example.test/#fragment",
    "https://example.test/?",
    "https://example.test/#",
  ])
    assert.throws(() => createIpfsGatewayClient(url));
  assert.throws(() => createIpfsGatewayClient("https://example.test", { maxBlockBytes: 0 }));
});

test("Gateway times out and cancels headers/body, rejects redirects and unavailable endpoints", async (t) => {
  const cid = "bafkreigh2akiscaildcx3muflssxfgcpk2wf75l7vx7iw4umq36aywgyki";
  let redirected = 0;
  const server = createServer((request, response) => {
    if (request.url!.startsWith("/target")) redirected++;
    if (request.url!.startsWith("/redirect")) {
      response.writeHead(302, { location: `/target/ipfs/${cid}?format=raw` }).end();
    } else if (request.url!.startsWith("/body")) {
      response.writeHead(200, { "content-type": "application/vnd.ipld.raw" });
      response.write("partial");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((done) => server.close(() => done()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  for (const path of ["/headers", "/body"]) {
    const client = createIpfsGatewayClient(base + path, { timeoutMs: 100 });
    await assert.rejects(client.block.get(cid), /timeout|abort/i);
    const controller = new AbortController();
    const pending = createIpfsGatewayClient(base + path).block.get(cid, {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending, /abort/i);
    await assert.rejects(client.block.get(cid, { signal: AbortSignal.abort() }), /abort/i);
  }
  await assert.rejects(createIpfsGatewayClient(`${base}/redirect`).block.get(cid));
  assert.equal(redirected, 0);
  await assert.rejects(createIpfsGatewayClient("http://127.0.0.1:1").block.get(cid));
});
