import assert from "node:assert/strict";
import test from "node:test";
import { CarReader, CarWriter } from "@ipld/car";
import * as dagPb from "@ipld/dag-pb";
import { CID } from "multiformats/cid";
import { collectBytes } from "../src/blocks.js";
import {
  encodeContentCar,
  importContent,
  openContent,
  pinContent,
  retainContent,
  validateContentCar,
  writeContentCar,
} from "../src/index.js";
import { MemoryIpfsClient } from "../src/testing.js";

const expectedRoot = "bafybeiebhql7fgalsvwuy55kkhii3pfukhjdyauualacmnkzeij4z6t6tq";
const identities = [
  ["bafkreibruh455iawsviqslif5c7uurdcfdemh22mtnytyzvnzn75kpejxy", 262144],
  ["bafkreicu5xq3vyqm4z3c3mv7of52m6yg7rww4gbvlryiul4ppue55hemty", 175712],
  ["bafkreihddpoggv3745xwiqibjkvkeitnt76ocg2e2dkrbsw6cmvxt7l5oy", 262144],
  ["bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku", 0],
  ["bafkreihfqt5oau2pdu7d2y6j4ysu6sjgahdxhxtquxowqks6wihjghrga4", 23],
  ["bafybeiat65mgaomregcezwr6uzau6iumvujm3xlrtud36wlbpivuexuu24", 158],
  [expectedRoot, 109],
  ["bafybeigds26xkdo7ysxfflms7vmjqka6flhc46ghbmnn6pe57yvnkz2zuy", 112],
];
function fixture() {
  return new Map([
    ["small.txt", Buffer.from("OSS migration baseline\n")],
    ["nested/large.bin", Buffer.from(Array.from({ length: 700_000 }, (_, i) => i % 251))],
    ["nested/empty.txt", Buffer.alloc(0)],
  ]);
}
async function archive(
  roots: CID[],
  blocks: { cid: CID; bytes: Uint8Array }[],
): Promise<Uint8Array> {
  const { writer, out } = CarWriter.create(roots);
  const writing = (async () => {
    for (const block of blocks) await writer.put(block);
    await writer.close();
  })();
  const bytes = await collectBytes(out, 2 * 1024 * 1024);
  await writing;
  return bytes;
}

test("Helia UnixFS/CAR preserve the pre-migration root, all eight blocks, order independence and exact file bytes", async () => {
  const files = fixture();
  const first = await encodeContentCar(files);
  assert.equal(first.cid, expectedRoot);
  assert.deepEqual(await encodeContentCar(new Map([...files].reverse())), first);
  const reader = await CarReader.fromBytes(first.bytes);
  assert.deepEqual((await reader.getRoots()).map(String), [expectedRoot]);
  const blocks = [];
  for await (const block of reader.blocks())
    blocks.push([block.cid.toString(), block.bytes.length]);
  assert.deepEqual(
    blocks.sort(([a], [b]) => String(a).localeCompare(String(b))),
    identities,
  );
  const memory = new MemoryIpfsClient();
  await writeContentCar(first.bytes, expectedRoot, memory);
  assert.equal(memory.pins.size, 0, "Import never implicitly pins.");
  for (const [path, bytes] of files) {
    const entry = await openContent(memory, `${expectedRoot}/${path}`, {
      signal: new AbortController().signal,
    });
    assert.ok(entry.type === "file" || entry.type === "raw");
    assert.deepEqual(Buffer.from(await collectBytes(entry.content(), 2 * 1024 * 1024)), bytes);
  }
  await pinContent(expectedRoot, memory);
  assert.deepEqual([...memory.pins], [expectedRoot]);
});

test("the UnixFS layout stays balanced at exactly 174 children rather than Helia's 1024-child default", async () => {
  const nodes = new Map<string, dagPb.PBNode>();
  const bytes = Buffer.alloc(175 * 262_144, 42);
  const cid = await importContent(new Map([["large.bin", bytes]]), async (key, block) => {
    if (CID.parse(key).code === dagPb.code) nodes.set(key, dagPb.decode(block));
  });
  const file = nodes.get(nodes.get(cid)!.Links[0]!.Hash.toString())!;
  assert.equal(file.Links.length, 2);
  assert.equal(Math.max(...[...nodes.values()].map((node) => node.Links.length)), 174);
  assert.ok([...nodes.values()].some((node) => node.Links.length === 174));
});

test("CAR admission rejects tampering, missing blocks, wrong/multiple roots, extra blocks and resource overruns", async () => {
  const encoded = await encodeContentCar(fixture());
  const reader = await CarReader.fromBytes(encoded.bytes);
  const blocks = [];
  for await (const block of reader.blocks()) blocks.push(block);
  const rawIndex = blocks.findIndex((block) => block.bytes.length === 262_144);
  assert.ok(rawIndex >= 0);
  const substitutedCodec = blocks.map((block) =>
    block.bytes.length === 0
      ? { ...block, cid: CID.createV1(dagPb.code, block.cid.multihash) }
      : block,
  );
  await assert.rejects(
    validateContentCar(await archive([CID.parse(expectedRoot)], substitutedCodec), expectedRoot),
    /outside its root/,
  );
  const corrupt = blocks.map((block, index) =>
    index === rawIndex
      ? { ...block, bytes: Uint8Array.from(block.bytes, (byte) => byte ^ 1) }
      : block,
  );
  const badHash = await archive([CID.parse(expectedRoot)], corrupt);
  assert.equal(
    (await CarReader.fromBytes(badHash)).version,
    1,
    "The CAR parser does not verify hashes.",
  );
  await assert.rejects(validateContentCar(badHash, expectedRoot), /CID verification/);
  await assert.rejects(
    validateContentCar(
      await archive(
        [CID.parse(expectedRoot)],
        blocks.filter((_, i) => i !== rawIndex),
      ),
      expectedRoot,
    ),
  );
  await assert.rejects(
    validateContentCar(
      await archive(
        [CID.parse(expectedRoot)],
        blocks.filter((block) => block.cid.toString() !== expectedRoot),
      ),
      expectedRoot,
    ),
  );
  await assert.rejects(
    validateContentCar(encoded.bytes, blocks[rawIndex]!.cid.toString()),
    /expected root/,
  );
  await assert.rejects(validateContentCar(encoded.bytes, ""));
  await assert.rejects(validateContentCar(await archive([], blocks)), /expected root/);
  await assert.rejects(
    validateContentCar(await archive([CID.parse(expectedRoot), blocks[rawIndex]!.cid], blocks)),
    /expected root/,
  );
  const extra = await encodeContentCar(new Map([["unrelated", Buffer.from("unrelated")]]));
  const extraReader = await CarReader.fromBytes(extra.bytes);
  const extraBlocks = [];
  for await (const block of extraReader.blocks()) extraBlocks.push(block);
  await assert.rejects(
    validateContentCar(
      await archive([CID.parse(expectedRoot)], [...blocks, ...extraBlocks]),
      expectedRoot,
    ),
    /outside its root/,
  );
  for (const options of [{ maxCarBytes: 1 }, { maxBlockBytes: 1 }, { maxDagBlocks: 1 }]) {
    await assert.rejects(validateContentCar(encoded.bytes, expectedRoot, options), /capacity/);
    await assert.rejects(encodeContentCar(fixture(), options), /capacity/);
  }
  const controller = new AbortController();
  controller.abort(new Error("cancel CAR admission"));
  await assert.rejects(
    validateContentCar(encoded.bytes, expectedRoot, { signal: controller.signal }),
    /cancel CAR/,
  );
  let calls = 0;
  await assert.rejects(
    writeContentCar(badHash, expectedRoot, {
      dag: {
        async *import() {
          calls++;
          yield* [];
        },
      },
    }),
  );
  assert.equal(calls, 0, "No publication before complete local CAR admission.");
  const preflight = new Uint8Array(2);
  Object.defineProperty(preflight, Symbol.iterator, {
    value: () => {
      throw new Error("CAR copied before preflight.");
    },
  });
  const client = {
    dag: {
      async *import() {
        yield* [];
      },
    },
  };
  await assert.rejects(
    writeContentCar(preflight, expectedRoot, client, { maxCarBytes: 1 }),
    /CAR capacity/,
  );
  await assert.rejects(
    writeContentCar(preflight, expectedRoot, client, { signal: controller.signal }),
    /cancel CAR/,
  );
});

test("official full-DAG traversal deduplicates blocks, retains bounded verified bytes and stops at cancellation", async () => {
  const memory = new MemoryIpfsClient();
  const cid = await memory.import(
    new Map([
      ["a", Buffer.alloc(600_000, 42)],
      ["b", Buffer.alloc(600_000, 42)],
    ]),
  );
  const reads: string[] = [];
  const controller = new AbortController();
  const client = {
    block: {
      async get(key: string) {
        reads.push(key);
        return memory.block.get(key);
      },
    },
  };
  const retainedBlocks = new Map<string, Uint8Array>();
  await retainContent(client, cid, { signal: controller.signal, retainedBlocks });
  assert.equal(new Set(reads).size, reads.length);
  assert.deepEqual(new Set(reads), new Set(memory.blocks.keys()));
  assert.equal(memory.pins.size, 0);
  await assert.rejects(
    retainContent(client, cid, {
      signal: controller.signal,
      inspectNode() {
        controller.abort(new Error("cancel traversal"));
      },
    }),
    /cancel traversal/,
  );
});
