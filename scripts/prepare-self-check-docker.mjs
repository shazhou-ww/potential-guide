import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const harnessFiles = [
  "Dockerfile",
  "prepare-image.mjs",
  "fixture.mjs",
  "verify.mjs",
  "real-agent.mjs",
  "keychain.mjs",
  "keychain-entrypoint.sh",
  "keychain-unlock.sh",
  "README.md",
];

export async function prepareContext(repository, revision, destination) {
  assert.match(revision, /^[a-f0-9]{40}$/u, "Use an explicit full repository commit SHA");
  const context = resolve(destination);
  const location = relative(repository, context);
  assert.ok(
    location && !isAbsolute(location) && location !== ".." && !location.startsWith(".."),
    "Context must be a new directory inside the repository",
  );
  const commit = spawnSync("git", ["rev-parse", "--verify", `${revision}^{commit}`], {
    cwd: repository,
    encoding: "utf8",
  });
  assert.equal(commit.status, 0, commit.stderr);
  assert.equal(commit.stdout.trim(), revision);
  await mkdir(context, { recursive: false });
  const archive = spawn("git", ["-c", "core.autocrlf=false", "archive", "--format=tar", revision], {
    cwd: repository,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const completion = new Promise((resolve, reject) => {
    archive.once("error", reject);
    archive.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("git archive failed")),
    );
  });
  // Never print archive diagnostics or include host configuration in the context.
  archive.stderr.resume();
  await Promise.all([
    pipeline(archive.stdout, createWriteStream(join(context, "source.tar"), { flags: "wx" })),
    completion,
  ]);
  const hashes = {};
  for (const name of harnessFiles) {
    const original = await readFile(join(root, "scripts", "self-check-docker", name));
    const content = name.endsWith(".sh")
      ? Buffer.from(original.toString("utf8").replaceAll("\r\n", "\n"))
      : original;
    await writeFile(join(context, name), content, { flag: "wx" });
    hashes[name] = createHash("sha256").update(content).digest("hex");
  }
  const provenance = {
    sourceRevision: revision,
    sourceArchiveSha256: createHash("sha256")
      .update(await readFile(join(context, "source.tar")))
      .digest("hex"),
    harnessSha256: hashes,
  };
  await writeFile(join(context, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  await writeFile(
    join(context, ".dockerignore"),
    `**\n!source.tar\n!provenance.json\n!${harnessFiles.join("\n!")}\n`,
  );
  return { context, ...provenance };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [revision, destination, ...extra] = process.argv.slice(2);
  assert.ok(
    revision && destination && extra.length === 0,
    "Usage: node scripts/prepare-self-check-docker.mjs <full-commit> <new-context-directory>",
  );
  console.log(JSON.stringify(await prepareContext(root, revision, destination), null, 2));
}
