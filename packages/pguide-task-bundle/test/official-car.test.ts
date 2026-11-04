import assert from "node:assert/strict";
import test from "node:test";
import { CarReader } from "@ipld/car";
import { computeContentCid, encodeContentCar, validateContentCar } from "../src/car.js";

test("offline CAR preserves the pre-migration canonical CID, ordering and complete DAG", async () => {
  const files = new Map([
    ["small.txt", Buffer.from("OSS migration baseline\n")],
    ["nested/large.bin", Buffer.from(Array.from({ length: 700_000 }, (_, i) => i % 251))],
    ["nested/empty.txt", Buffer.alloc(0)],
  ]);
  const expected = "bafybeiebhql7fgalsvwuy55kkhii3pfukhjdyauualacmnkzeij4z6t6tq";
  const encoded = await encodeContentCar(files);
  assert.equal(encoded.cid, expected);
  assert.deepEqual(await encodeContentCar(new Map([...files].reverse())), encoded);
  assert.equal(await computeContentCid(files), expected);
  const blocks = [];
  for await (const block of (await CarReader.fromBytes(encoded.bytes)).blocks()) blocks.push(block);
  assert.equal(blocks.length, 8);
  assert.ok(blocks.some((block) => block.cid.toString() === expected));
  assert.equal((await validateContentCar(encoded.bytes, expected)).cid, expected);
  const corrupted = Uint8Array.from(encoded.bytes);
  corrupted[corrupted.length - 1]! ^= 1;
  await assert.rejects(validateContentCar(corrupted));
  for (const options of [{ maxCarBytes: 100 }, { maxDagBlocks: 1 }, { maxBlockBytes: 100 }])
    await assert.rejects(validateContentCar(encoded.bytes, undefined, options), /capacity/);
});
