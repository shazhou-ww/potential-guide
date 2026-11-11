import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCheckResources } from "@potential-guide/check-sdk/authoring";
import { buildTask, readTaskArtifact } from "@potential-guide/task-authoring";
import { prepareEnvironment } from "./prepare.mjs";

export async function stageCheck(check, built, candidate) {
  if (typeof built.cid !== "string") throw new Error(`Check ${check.kind}: missing expected CID.`);
  const car = await readTaskArtifact(built.car, built.cid);
  const directory = await readTaskArtifact(built.directory, built.cid);
  verifyCheckResources(check, car.files);
  verifyCheckResources(check, directory.files);
  if (!car.archive) throw new Error(`Check ${check.kind}: expected a CAR file.`);
  for (const [path, bytes] of directory.files) {
    const target = join(candidate, check.kind, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await writeFile(join(candidate, `${check.kind}.car`), car.archive);
  return {
    directory: check.kind,
    car: `${check.kind}.car`,
    cid: built.cid,
  };
}
export async function readReferences(directory, checks) {
  const references = JSON.parse(await readFile(join(directory, "references.json"), "utf8"));
  if (
    JSON.stringify(Object.keys(references).sort()) !==
    JSON.stringify(checks.map(({ kind }) => kind).sort())
  )
    throw new Error("Environment references do not match configured checks.");
  for (const check of checks) {
    const reference = references[check.kind];
    if (
      typeof reference.cid !== "string" ||
      reference.car !== `${check.kind}.car` ||
      reference.directory !== check.kind
    )
      throw new Error(`Check ${check.kind}: invalid artifact paths.`);
  }
  return references;
}

/** Cached candidates never overwrite accepted outputs until all checks pass. */
export async function acceptChecks(root, checks) {
  const candidate = join(root, "dist", "candidate");
  const references = await readReferences(candidate, checks);
  const accepting = join(root, "dist", "accepting-bundles");
  await rm(accepting, { recursive: true, force: true });
  await mkdir(accepting, { recursive: true });
  for (const check of checks) {
    const reference = references[check.kind];
    await stageCheck(
      check,
      {
        directory: join(candidate, reference.directory),
        car: join(candidate, reference.car),
        cid: reference.cid,
      },
      accepting,
    );
  }
  await writeFile(join(accepting, "references.json"), `${JSON.stringify(references, null, 2)}\n`);
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
    await rename(accepting, output);
  } catch (error) {
    if (moved) await rename(previous, output);
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
}

export async function buildEnvironment(root, accept = true) {
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
  for (const check of prepared)
    references[check.kind] = await stageCheck(check, await buildTask(check.buildFile), candidate);
  await writeFile(join(candidate, "references.json"), `${JSON.stringify(references, null, 2)}\n`);
  if (accept) await acceptChecks(root, prepared);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv.slice(2).find((argument) => argument !== "--candidate");
  await buildEnvironment(
    root ? resolve(root) : fileURLToPath(new URL(".", import.meta.url)),
    !process.argv.includes("--candidate"),
  );
}
