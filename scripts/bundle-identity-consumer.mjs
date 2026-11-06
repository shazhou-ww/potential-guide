import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { CarReader, CarWriter } from "@ipld/car";
import { buildTask, taskBuildSchemaUri } from "@potential-guide/pguide-task-bundle";
import { readTaskArtifact } from "@potential-guide/pguide-task-bundle/artifact";
import { encodeContentCar } from "@potential-guide/pguide-task-bundle/car";

await mkdir("identity/assets", { recursive: true });
await writeFile("identity/main.ts", "export default async () => null;\n");
await writeFile(
  "identity/contract.ts",
  'import {Type} from "@sinclair/typebox";export default {input:Type.Object({}),result:Type.Null(),message:Type.Never()};\n',
);
const definition = {
  $schema: taskBuildSchemaUri,
  name: "Packed content identity",
  runtime: { minVersion: "22.13.0" },
  source: { entry: "main.ts", contract: "contract.ts" },
  include: [{ from: "assets/*", to: "resources/renamed/" }],
  binary: ["resources/renamed/raw.bin"],
  outDirectory: "bundle",
};
await writeFile("identity/task.build.yaml", JSON.stringify(definition));
const binary = Buffer.from([255, 0, 13, 10, 13]);
await writeFile("identity/assets/raw.bin", binary);
let cid;
let fixedCid;
for (const newline of ["\n", "\r\n", "\r"]) {
  await writeFile("identity/assets/text", `\uFEFFfirst ${newline}第二${newline}${newline}`);
  const built = await buildTask("identity/task.build.yaml");
  cid ??= built.cid;
  assert.equal(built.cid, cid);
  const car = await readTaskArtifact(built.car, cid);
  assert.deepEqual(car.files, (await readTaskArtifact(built.directory, cid)).files);
  assert.deepEqual(car.files.get("resources/renamed/raw.bin"), binary);
  assert.equal(car.files.get("resources/renamed/text").toString(), "\uFEFFfirst \n第二\n\n");
  await assert.rejects(
    readTaskArtifact(built.car, "bafybeicec2jdrocgnsdvhwp3pcauoaummfmszt3rftjzypchnrckyfrl6m"),
    /expected CID/,
  );

  // Fixed Worker/declaration keep the cross-platform probe independent of compiler versions.
  const files = new Map([
    [
      "task.yaml",
      Buffer.from(
        JSON.stringify({
          $schema: "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task/v1.json",
          name: "Portable content identity v1",
          runtime: { type: "node", minVersion: "22.13.0" },
          entry: "worker.cjs",
          include: ["resources/raw.bin", "resources/text", "task.yaml", "worker.cjs"],
          binary: ["resources/raw.bin"],
          inputSchema: { type: "object" },
          resultSchema: true,
          messageSchema: false,
        }),
      ),
    ],
    ["worker.cjs", Buffer.from("module.exports = {};\n")],
    ["resources/raw.bin", car.files.get("resources/renamed/raw.bin")],
    ["resources/text", car.files.get("resources/renamed/text")],
  ]);
  const fixed = await encodeContentCar(files);
  assert.equal(fixed.cid, "bafybeibtkmjrucx7wqozzwuewnwtdoyhyucpr3wp2jbmmjr3zjjeugog2m");
  fixedCid ??= fixed.cid;
  assert.equal(fixed.cid, fixedCid);
  const reader = await CarReader.fromBytes(fixed.bytes);
  const blocks = [];
  for await (const block of reader.blocks()) blocks.push(block);
  const { writer, out } = CarWriter.create(await reader.getRoots());
  const chunks = [];
  const collect = (async () => {
    for await (const chunk of out) chunks.push(chunk);
  })();
  for (const block of blocks.reverse()) await writer.put(block);
  await writer.close();
  await collect;
  const reordered = Buffer.concat(chunks);
  assert.notDeepEqual(reordered, Buffer.from(fixed.bytes));
  await writeFile("identity/fixed.car", reordered);
  assert.equal((await readTaskArtifact("identity/fixed.car", fixedCid)).cid, fixedCid);
}
await writeFile("identity/assets/text", Buffer.from([255]));
await assert.rejects(buildTask("identity/task.build.yaml"), /UTF-8.*resources\/renamed\/text/);
const original = await readFile("identity/bundle.car");
assert.equal((await readTaskArtifact("identity/bundle.car")).cid, cid);
assert.deepEqual(await readFile("identity/bundle.car"), original);
console.log(`Bundle content identity (${process.platform}): ${fixedCid}`);
console.log(`Bundle build identity (${process.platform}): ${cid}`);
