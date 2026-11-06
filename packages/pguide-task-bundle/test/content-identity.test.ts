import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { CarReader, CarWriter } from "@ipld/car";
import { CID } from "multiformats/cid";
import { normalizeTaskText, readTaskBundle, taskSchemaUri } from "@potential-guide/task-protocol";
import { buildTask, taskBuildSchemaUri } from "../src/authoring.js";
import { readTaskArtifact } from "../src/artifact.js";
import { encodeContentCar } from "../src/car.js";

test("UTF-8/LF normalization preserves every other byte and is idempotent", () => {
  for (const text of ["", "\uFEFFa \t\n\n", "a\nb\nc", "\0é e\u0301\n末尾", "\n\n"]) {
    const expected = Buffer.from(text);
    for (const eol of ["\n", "\r\n", "\r"]) {
      const actual = normalizeTaskText(Buffer.from(text.replaceAll("\n", eol)), "resources/text");
      assert.deepEqual(Buffer.from(actual), expected);
      assert.deepEqual(normalizeTaskText(actual, "resources/text"), actual);
    }
  }
  assert.equal(
    Buffer.from(normalizeTaskText(Buffer.from("a\r\nb\rc\n"), "mixed")).toString(),
    "a\nb\nc\n",
  );
  for (const bytes of [[0xff], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xe2, 0x82]])
    assert.throws(
      () => normalizeTaskText(Uint8Array.from(bytes), "resources/bad"),
      /UTF-8.*resources\/bad/,
    );
});

function files(binary: string[] = []) {
  const content = new Map([
    ["worker.cjs", Buffer.from("module.exports = {};\n")],
    ["resources/a", Buffer.from("\uFEFFa\n")],
    ["resources/b", Buffer.from("b\n")],
  ]);
  content.set(
    "task.yaml",
    Buffer.from(
      JSON.stringify({
        $schema: taskSchemaUri,
        name: "Identity",
        runtime: { type: "node", minVersion: "22.13.0" },
        entry: "worker.cjs",
        include: ["task.yaml", ...content.keys()].sort(),
        binary,
        inputSchema: { type: "object" },
        resultSchema: true,
        messageSchema: false,
      }),
    ),
  );
  return content;
}

test("standalone readers require an exact sorted binary subset and never repair text", () => {
  for (const binary of [
    ["resources/missing"],
    ["resources/b", "resources/a"],
    ["resources/a", "resources/a"],
    ["worker.cjs"],
    ["task.yaml"],
    ["schemas/0.json"],
    ["resources/../a"],
    ["resources/*"],
  ])
    assert.throws(() => readTaskBundle(files(binary)), /binary|declaration/i);
  const old = files();
  const declaration = JSON.parse(old.get("task.yaml")!.toString());
  delete declaration.binary;
  old.set("task.yaml", Buffer.from(JSON.stringify(declaration)));
  assert.throws(() => readTaskBundle(old), /binary.*Rebuild/);
  for (const path of ["task.yaml", "worker.cjs", "resources/a"]) {
    const content = files();
    content.set(path, Buffer.concat([content.get(path)!, Buffer.from("\r")]));
    const before = Buffer.from(content.get(path)!);
    assert.throws(() => readTaskBundle(content), /Non-LF/);
    assert.deepEqual(content.get(path), before);
  }
  const binary = files(["resources/a"]);
  binary.set("resources/a", Buffer.from([255, 13, 10, 0]));
  readTaskBundle(binary);
});

test("final-path globs normalize one directory/CAR snapshot; binary is explicit, never sniffed", async (t) => {
  const root = resolve(".cache", `content-identity-${randomUUID()}`);
  await mkdir(join(root, "assets", "nested"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  await writeFile(join(root, "main.ts"), "export default async () => null;\n");
  await writeFile(
    join(root, "contract.ts"),
    'import {Type} from "@sinclair/typebox";export default {input:Type.Object({}),result:Type.Null(),message:Type.Never()};\n',
  );
  const definition = {
    $schema: taskBuildSchemaUri,
    name: "Normalized",
    runtime: { minVersion: "22.13.0" },
    source: { entry: "main.ts", contract: "contract.ts" },
    include: [{ from: "assets/**/*", to: "resources/renamed/" }],
    binary: ["resources/renamed/**/*.BIN", "resources/not-selected/**"],
    outDirectory: "dist",
  };
  const buildFile = join(root, "task.build.yaml");
  await writeFile(buildFile, JSON.stringify(definition));
  const raw = Buffer.from([255, 13, 10, 13, 0]);
  await writeFile(join(root, "assets", "nested", "raw.BIN"), raw);
  let cid: string | undefined;
  for (const eol of ["\n", "\r\n", "\r"]) {
    const text = Buffer.from(`\uFEFFfirst ${eol}第二${eol}${eol}`);
    await writeFile(join(root, "assets", "page.bin"), text);
    const built = await buildTask(buildFile);
    cid ??= built.cid;
    assert.equal(built.cid, cid);
    const directory = await readTaskArtifact(built.directory, cid);
    const car = await readTaskArtifact(built.car, cid);
    assert.deepEqual(directory.files, car.files);
    assert.deepEqual(car.files.get("resources/renamed/nested/raw.BIN"), raw);
    assert.equal(car.files.get("resources/renamed/page.bin")!.toString(), "\uFEFFfirst \n第二\n\n");
    assert.deepEqual(readTaskBundle(car.files).declaration.binary, [
      "resources/renamed/nested/raw.BIN",
    ]);
    assert.deepEqual(await readFile(join(root, "assets", "page.bin")), text);
  }
  for (const binary of [
    ["assets/**"],
    ["resources/renamed/**/*.bin"],
    ["../outside"],
    ["**"],
    ["worker.cjs"],
  ]) {
    await writeFile(buildFile, JSON.stringify({ ...definition, binary }));
    await assert.rejects(buildTask(buildFile), /UTF-8.*raw.BIN|binary|portable/);
  }
});

test("same root accepts reordered CAR blocks; wrong roots and corrupt DAGs fail; snapshots survive replacement", async (t) => {
  const root = resolve(".cache", `car-identity-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const encoded = await encodeContentCar(files());
  const reader = await CarReader.fromBytes(encoded.bytes);
  const blocks: { cid: CID; bytes: Uint8Array }[] = [];
  for await (const block of reader.blocks()) blocks.push(block);
  const roots = await reader.getRoots();
  const serialize = async (selected: typeof blocks, selectedRoots = roots) => {
    const { writer, out } = CarWriter.create(selectedRoots);
    const chunks: Uint8Array[] = [];
    const collect = (async () => {
      for await (const chunk of out) chunks.push(chunk);
    })();
    for (const block of selected) await writer.put(block);
    await writer.close();
    await collect;
    return Buffer.concat(chunks);
  };
  const path = join(root, "bundle.car");
  const reversed = await serialize([...blocks].reverse());
  assert.notDeepEqual(reversed, Buffer.from(encoded.bytes));
  await writeFile(path, reversed);
  const snapshot = await readTaskArtifact(path, encoded.cid);
  assert.equal(snapshot.cid, encoded.cid);
  assert.equal(
    (await readTaskArtifact(path, CID.parse(encoded.cid).toV0().toString())).cid,
    encoded.cid,
  );
  const other = files();
  other.set("resources/a", Buffer.from("other\n"));
  const replacement = await encodeContentCar(other);
  const replacementReader = await CarReader.fromBytes(replacement.bytes);
  const extra = [];
  for await (const block of replacementReader.blocks())
    if (!blocks.some((original) => original.cid.equals(block.cid))) extra.push(block);
  await assert.rejects(readTaskArtifact(path, replacement.cid), /expected CID/);
  await writeFile(path, replacement.bytes);
  const delivered = join(root, "delivered.car");
  await writeFile(delivered, snapshot.archive!);
  assert.equal((await readTaskArtifact(delivered)).cid, encoded.cid);
  assert.equal((await readTaskArtifact(path)).cid, replacement.cid);
  for (const damaged of [
    await serialize(blocks.slice(1)),
    await serialize([...blocks, ...extra]),
    await serialize(blocks, [...roots, ...(await replacementReader.getRoots())]),
    await serialize(
      blocks.map((block, index) => (index ? block : { ...block, bytes: Uint8Array.from([0]) })),
    ),
  ]) {
    await writeFile(path, damaged);
    await assert.rejects(readTaskArtifact(path));
  }
});
