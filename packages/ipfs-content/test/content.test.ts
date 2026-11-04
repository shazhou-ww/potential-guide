import assert from "node:assert/strict";
import test from "node:test";
import { openContent } from "../src/index.js";
import { MemoryIpfsClient } from "../src/testing.js";

test("standard exporter reads individual files and reports missing, corrupt and midstream errors", async () => {
  const client = new MemoryIpfsClient();
  const bytes = Buffer.concat([
    Buffer.alloc(262_144, 1),
    Buffer.alloc(262_144, 2),
    Buffer.alloc(100, 3),
  ]);
  const root = await client.import(new Map([["resources/file.bin", bytes]]));
  const source = {
    block: {
      get: async (cid: string) => {
        const block = await client.block.get(cid);
        if (cid.startsWith("bafk") && block[0] === 2)
          throw new Error("Controlled midstream missing block.");
        return block;
      },
    },
  };
  const entry = await openContent(source, `${root}/resources/file.bin`, {
    signal: new AbortController().signal,
  });
  assert.equal(entry.type, "file");
  if (entry.type !== "file") throw new Error("Expected UnixFS file.");
  const stream = entry.content()[Symbol.asyncIterator]();
  assert.deepEqual(Buffer.from((await stream.next()).value!), bytes.subarray(0, 262_144));
  await assert.rejects(stream.next(), /Controlled midstream/);
  await assert.rejects(
    openContent(client, `${root}/missing`, { signal: new AbortController().signal }),
  );
  await assert.rejects(
    openContent({ block: { get: async () => new Uint8Array([0]) } }, root, {
      signal: new AbortController().signal,
    }),
    /CID verification/,
  );
});
test("reads obey consumer demand and gateway failures are never successful empty/truncated content", async () => {
  const client = new MemoryIpfsClient();
  const root = await client.import(new Map([["file.bin", Buffer.alloc(800_000, 42)]]));
  let reads = 0;
  const entry = await openContent(
    {
      block: {
        get: async (cid, options) => {
          reads++;
          return client.block.get(cid, options);
        },
      },
    },
    `${root}/file.bin`,
    { signal: new AbortController().signal },
  );
  const metadataReads = reads;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(reads, metadataReads, "No file reads until consumer requests a chunk.");
  if (entry.type !== "file") throw new Error("Expected UnixFS file.");
  const stream = entry.content()[Symbol.asyncIterator]();
  await stream.next();
  const afterFirst = reads;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(reads - afterFirst <= 1, "Read-ahead is bounded to one range boundary block.");
  assert.ok(reads - metadataReads <= 2);
  await stream.return?.();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(openContent(client, root, { signal: controller.signal }));
  let calls = 0;
  await assert.rejects(
    openContent(
      {
        block: {
          get: async () => {
            throw new Error("offline");
          },
        },
      },
      root,
      {
        signal: new AbortController().signal,
        gateways: ["http://localhost:8080"],
        allowGateway: () => true,
        fetch: async () => {
          calls++;
          return new Response(new Uint8Array([0]), {
            headers: { "content-type": "application/vnd.ipld.raw" },
          });
        },
      },
    ),
    /CID verification/,
  );
  assert.equal(calls, 1);
});
