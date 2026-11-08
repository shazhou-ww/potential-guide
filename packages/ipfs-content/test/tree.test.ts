import assert from "node:assert/strict";
import test from "node:test";
import { unixfs } from "@helia/unixfs";
import { MemoryBlockstore } from "blockstore-core";
import { CID } from "multiformats/cid";
import { readContentTree } from "../src/tree.js";
import { MemoryIpfsClient } from "../src/testing.js";

test("canonical tree snapshots enforce byte, file, block, cancellation and closure budgets", async () => {
  const client = new MemoryIpfsClient();
  const files = new Map([
    ["one.txt", Buffer.from("one\n")],
    ["child/two.txt", Buffer.from("two\n")],
  ]);
  const cid = await client.import(files);
  const signal = new AbortController().signal;
  const tree = await readContentTree(client, cid, { signal });
  assert.equal(tree.cid, cid);
  assert.equal(tree.roots.size, 2);
  for (const [path, bytes] of files) assert.deepEqual(tree.files.get(path), Uint8Array.from(bytes));
  for (const limits of [{ maxBytes: 1 }, { maxFiles: 1 }, { maxPaths: 1 }, { maxDagBlocks: 1 }])
    await assert.rejects(readContentTree(client, cid, { signal, ...limits }), /budget exceeded/);
  await assert.rejects(
    readContentTree(client, cid, { signal: AbortSignal.abort(new Error("stop")) }),
    /stop/,
  );
  for (const key of client.blocks.keys()) if (key !== cid) client.blocks.delete(key);
  await assert.rejects(readContentTree(client, cid, { signal }), /unavailable/);
});

test("tree admission rejects equivalent bytes imported with a different UnixFS profile", async () => {
  const store = new MemoryBlockstore();
  let root = "";
  for await (const entry of unixfs({ blockstore: store }).addAll(
    [{ path: "one.txt", content: Buffer.from("one\n") }],
    { wrapWithDirectory: true, rawLeaves: false, cidVersion: 1 },
  ))
    root = entry.cid.toString();
  await assert.rejects(
    readContentTree(
      {
        block: {
          async get(cid) {
            const chunks: Uint8Array[] = [];
            for await (const bytes of store.get(CID.parse(cid))) chunks.push(bytes);
            return Buffer.concat(chunks);
          },
        },
      },
      root,
      { signal: new AbortController().signal },
    ),
    /canonical file tree/,
  );
});
