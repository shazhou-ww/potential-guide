import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCheckResources } from "@potential-guide/check-sdk/authoring";
import { buildTask } from "@potential-guide/pguide-task-bundle";
import {
  inspectTaskArtifact,
  readTaskArtifact,
} from "@potential-guide/pguide-task-bundle/artifact";
import { prepareEnvironment } from "./prepare.mjs";

const root = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL(".", import.meta.url));
await copyFile(new URL("../../LICENSE", import.meta.url), join(root, "LICENSE"));
const prepared = await prepareEnvironment(root);
execFileSync(process.execPath, [fileURLToPath(import.meta.resolve("typescript/bin/tsc")), "-b"], {
  cwd: root,
  stdio: "inherit",
});
const candidate = join(root, "dist", "candidate");
await rm(candidate, { recursive: true, force: true });
await mkdir(candidate, { recursive: true });
const references = {};
for (const check of prepared) {
  const built = await buildTask(check.buildFile);
  const car = await readTaskArtifact(built.car);
  const directory = await readTaskArtifact(built.directory);
  verifyCheckResources(check, car.files);
  verifyCheckResources(check, directory.files);
  const carCid = (await inspectTaskArtifact(car.files)).cid;
  const directoryCid = (await inspectTaskArtifact(directory.files)).cid;
  if (carCid !== directoryCid || carCid !== built.cid)
    throw new Error(`Check ${check.kind}: candidate CAR/directory CID mismatch`);
  await cp(built.directory, join(candidate, check.kind), { recursive: true });
  await copyFile(built.car, join(candidate, `${check.kind}.car`));
  references[check.kind] = {
    directory: check.kind,
    car: `${check.kind}.car`,
    cid: built.cid,
  };
}
await writeFile(join(candidate, "references.json"), `${JSON.stringify(references, null, 2)}\n`);
const output = join(root, "dist", "bundles");
const previous = join(root, "dist", "previous-bundles");
await rm(previous, { recursive: true, force: true });
let moved = false;
try {
  try {
    await rename(output, previous);
    moved = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await rename(candidate, output);
} catch (error) {
  if (moved) await rename(previous, output);
  throw error;
}
await rm(previous, { recursive: true, force: true });
