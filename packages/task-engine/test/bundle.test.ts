import assert from "node:assert/strict";
import test from "node:test";
import { MemoryIpfsClient } from "@potential-guide/ipfs-content/testing";
import { taskSchemaUri } from "@potential-guide/task-protocol";
import { BundleCache, inspectTaskBundle } from "../src/bundle.js";

function files(extra: Record<string, Buffer> = {}) {
  return new Map(
    Object.entries({
      "task.yaml": Buffer.from(
        JSON.stringify({
          $schema: taskSchemaUri,
          name: "same name",
          runtime: { type: "node", minVersion: "22.13.0" },
          entry: "worker.cjs",
          inputSchema: { type: "object" },
          resultSchema: true,
          messageSchema: false,
        }),
      ),
      "worker.cjs": Buffer.from("module.exports = {};"),
      "resources/data.bin": Buffer.alloc(600_000, 42),
      ...extra,
    }),
  );
}
test("standard UnixFS imports are reproducible; full admission and verified chunked reads do not need directories", async () => {
  const client = new MemoryIpfsClient();
  const tree = files();
  const cid = await client.import(tree);
  const alias = (await client.pin.add(cid)).toV0().toString();
  assert.equal(await client.import(new Map([...tree].reverse())), cid);
  const cache = new BundleCache({ ipfsClient: client });
  try {
    const [a, b] = await Promise.all([
      cache.acquire(cid),
      cache.acquire({ cid, hint: ["http://unused", "http://also-unused"] }),
    ]);
    assert.equal(a.cid, b.cid);
    assert.equal(await cache.available(alias), true);
    assert.equal((await cache.detail(alias)).cid, cid);
    assert.deepEqual((await cache.list({ after: alias })).items, []);
    assert.equal((await cache.detail(cid)).leases, 2);
    assert.equal(await cache.evict(cid), false);
    assert.equal(await cache.evict(alias), false);
    // Engine-owned bounded verified blocks protect active content even if the node GC runs.
    client.blocks.clear();
    const iterator = await a.read("resources/data.bin", new AbortController().signal);
    const chunks: Uint8Array[] = [];
    for (;;) {
      const item = await iterator.next();
      if (item.done) break;
      chunks.push(item.value);
    }
    assert.ok(chunks.length > 1);
    assert.deepEqual(Buffer.concat(chunks), tree.get("resources/data.bin"));
    await assert.rejects(a.read("../worker.cjs", new AbortController().signal), {
      code: "invalid_bundle",
    });
    await assert.rejects(a.read("resources/missing", new AbortController().signal), {
      code: "invalid_bundle",
    });
    const controller = new AbortController();
    const canceled = await a.read("resources/data.bin", controller.signal);
    await canceled.next();
    controller.abort();
    await assert.rejects(canceled.next());
    a.release();
    a.release();
    assert.equal(await cache.evict(cid), false);
    b.release();
    assert.equal(await cache.evict(alias), true);
    await assert.rejects(cache.acquire(cid), { code: "bundle_fetch_failed" });
  } finally {
    await cache.close();
  }
});
test("gateway raw blocks are CID verified, ordered and subject to host access policy", async () => {
  const source = new MemoryIpfsClient();
  const cid = await source.import(files());
  const visited: string[] = [];
  const cache = new BundleCache({
    ipfsClient: {
      block: {
        get: async () => {
          throw new Error("offline");
        },
      },
    },
    allowGateway: (url) => url.hostname !== "blocked.test",
    fetch: async (input) => {
      const url = new URL(String(input));
      visited.push(url.hostname);
      if (url.hostname === "corrupt.test") return new Response(new Uint8Array([0]));
      const block = source.blocks.get(url.pathname.split("/").at(-1)!);
      return new Response(block ? Uint8Array.from(block) : null, { status: block ? 200 : 404 });
    },
  });
  try {
    const bundle = await cache.acquire({
      cid,
      hint: ["http://blocked.test", "http://corrupt.test", "http://good.test"],
    });
    assert.equal(bundle.cid, cid);
    assert.deepEqual(visited.slice(0, 2), ["corrupt.test", "good.test"]);
    assert.equal(visited.includes("blocked.test"), false);
    bundle.release();
  } finally {
    await cache.close();
  }
});
test("missing/corrupt blocks, non-directory roots, invalid files, incomplete schemas and budgets fail before admission", async () => {
  const client = new MemoryIpfsClient();
  const cid = await client.import(files());
  const corrupt = new BundleCache({
    ipfsClient: { block: { get: async () => new Uint8Array([1]) } },
  });
  await assert.rejects(corrupt.acquire(cid), { code: "bundle_fetch_failed" });
  await corrupt.close();
  for (const [tree, limits, code] of [
    [files({ "unexpected.txt": Buffer.from("bad") }), {}, "invalid_bundle"],
    [
      files({ "resources/A": Buffer.from("a"), "resources/a": Buffer.from("b") }),
      {},
      "invalid_bundle",
    ],
    [files({ "worker.cjs": Buffer.alloc(0) }), {}, "invalid_bundle"],
    [files({ "schemas/invalid.json": Buffer.from("{}") }), {}, "invalid_schema"],
    [files(), { bytes: 100 }, "capacity_exceeded"],
    [files(), { fileBytes: 100 }, "capacity_exceeded"],
    [files(), { files: 1 }, "capacity_exceeded"],
    [files(), { paths: 1 }, "capacity_exceeded"],
    [files(), { blocks: 1 }, "capacity_exceeded"],
    [files(), { protectedBytes: 100 }, "capacity_exceeded"],
  ] as const) {
    const root = await client.import(tree);
    const cache = new BundleCache({ ipfsClient: client, limits });
    await assert.rejects(cache.acquire(root), { code });
    await cache.close();
  }
  assert.throws(() => inspectTaskBundle(files({ "../outside": Buffer.from("bad") })), {
    code: "invalid_bundle",
  });
  const leaf = [...client.blocks].find(([, bytes]) => bytes.length === 262_144 && bytes[0] === 42)!;
  const fileRoot = new BundleCache({ ipfsClient: client });
  await assert.rejects(fileRoot.acquire(leaf[0]), { code: "invalid_bundle" });
  await fileRoot.close();
  client.blocks.delete(leaf[0]);
  const missingLeaf = new BundleCache({ ipfsClient: client });
  await assert.rejects(missingLeaf.acquire(cid), { code: "bundle_fetch_failed" });
  await missingLeaf.close();
  client.blocks.delete(cid);
  const absent = new BundleCache({ ipfsClient: client });
  await assert.rejects(absent.acquire(cid), { code: "bundle_fetch_failed" });
  await absent.close();
});
test("closing one Engine cache never closes shared client or removes anyone else's pins/protection", async () => {
  const client = new MemoryIpfsClient();
  let closed = 0,
    unpinned = 0;
  Object.assign(client, {
    close: () => {
      closed++;
    },
    pin: {
      rm: () => {
        unpinned++;
      },
    },
  });

  const cid = await client.import(files());
  const a = new BundleCache({ ipfsClient: client }),
    b = new BundleCache({ ipfsClient: client });
  const first = await a.acquire(cid),
    second = await b.acquire(cid);
  await a.close();
  const stream = await second.read("resources/data.bin", new AbortController().signal);
  assert.equal((await stream.next()).done, false);
  first.release();
  second.release();
  await b.close();
  assert.equal(closed, 0);
  assert.equal(unpinned, 0);
});
test("the total Engine-owned protection budget is bounded and reclaimed by explicit eviction", async () => {
  const client = new MemoryIpfsClient();
  const cid = await client.import(files());
  const other = await client.import(files({ "resources/extra": Buffer.from("another root") }));
  const cache = new BundleCache({ ipfsClient: client, limits: { protectedBytes: 500_000 } });
  try {
    const first = await cache.acquire(cid);
    await assert.rejects(cache.acquire(other), { code: "capacity_exceeded" });
    first.release();
    assert.equal(await cache.evict(cid), true);
    const second = await cache.acquire(other);
    second.release();
  } finally {
    await cache.close();
  }
});
