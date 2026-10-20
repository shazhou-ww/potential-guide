import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prepareContext } from "./prepare-self-check-docker.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
function git(cwd, args) {
  return execFileSync("git", ["-c", "core.autocrlf=false", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

test("Docker context contains the exact commit archive plus only explicit harness inputs", async () => {
  const repository = await mkdtemp(join(root, ".self-check-context-test-"));
  try {
    git(repository, ["init", "-q"]);
    await writeFile(join(repository, "tracked.txt"), "committed\n");
    git(repository, ["add", "tracked.txt"]);
    git(repository, [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "Fixture source",
    ]);
    const revision = git(repository, ["rev-parse", "HEAD"]);
    await writeFile(join(repository, "tracked.txt"), "uncommitted edit\n");
    await writeFile(join(repository, ".env"), "UNTRACKED_SECRET=not-a-real-credential\n");
    const context = join(repository, "context");
    const result = await prepareContext(repository, revision, context);
    const listing = execFileSync("tar", ["-tf", join(context, "source.tar")], {
      encoding: "utf8",
    }).trim();
    assert.equal(listing, "tracked.txt");
    const archived = execFileSync("tar", ["-xOf", join(context, "source.tar"), "tracked.txt"], {
      encoding: "utf8",
    });
    assert.equal(archived, "committed\n");
    assert.equal(result.sourceRevision, revision);
    assert.match(result.sourceArchiveSha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(Object.keys(result.harnessSha256).sort(), [
      "Dockerfile",
      "README.md",
      "fixture.mjs",
      "keychain-entrypoint.sh",
      "keychain-unlock.sh",
      "keychain.mjs",
      "prepare-image.mjs",
      "real-agent.mjs",
      "verify.mjs",
    ]);
    const second = await prepareContext(repository, revision, join(repository, "second"));
    assert.equal(second.sourceArchiveSha256, result.sourceArchiveSha256);
    assert.deepEqual(second.harnessSha256, result.harnessSha256);
    for (const script of ["keychain-entrypoint.sh", "keychain-unlock.sh"]) {
      const content = await readFile(join(context, script), "utf8");
      assert.ok(content.startsWith("#!/usr/bin/env bash\n"));
      assert.equal(content.includes("\r"), false);
    }
    assert.match(await readFile(join(context, ".dockerignore"), "utf8"), /^\*\*\n!source.tar\n/u);
    await assert.rejects(prepareContext(repository, revision, context), { code: "EEXIST" });
    await assert.rejects(
      prepareContext(repository, "HEAD", join(repository, "bad")),
      /full repository commit/u,
    );
    await assert.rejects(prepareContext(repository, revision, repository), /new directory inside/u);
    await assert.rejects(
      prepareContext(repository, revision, join(repository, "..", "outside")),
      /new directory inside/u,
    );
    await assert.rejects(prepareContext(repository, "0".repeat(40), join(repository, "bad")));
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});
