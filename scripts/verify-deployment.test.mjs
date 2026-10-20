import assert from "node:assert/strict";
import { access, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import test from "node:test";
import { createDeploymentWorkspace, execute } from "./verify-deployment-helpers.mjs";

test("packed deployment CI invokes the eight isolated package consumers", async () => {
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.match(manifest.scripts["deployment:verify"], /scripts\/verify-deployment\.mjs/);
  const source = await readFile(new URL("scripts/verify-deployment.mjs", root), "utf8");
  assert.match(
    source,
    /import \{ checkPackageConsumers \} from "\.\/check-package-consumers\.mjs"/,
  );
  assert.match(source, /if \(!installPublished\) \{\s+await checkPackageConsumers\(/);
  const consumers = await readFile(new URL("scripts/check-package-consumers.mjs", root), "utf8");
  assert.match(consumers, /"--prefer-offline"/);
  assert.doesNotMatch(consumers, /"--offline"/);
  const ci = await readFile(new URL(".github/workflows/ci.yaml", root), "utf8");
  assert.match(ci, /run: pnpm deployment:verify/);
});

test("execute preserves paths and arguments containing shell metacharacters", async () => {
  const workspace = await createDeploymentWorkspace();
  try {
    const specialDirectory = join(workspace.path, "space & (parentheses)");
    await mkdir(specialDirectory);
    const script = join(specialDirectory, "echo args.mjs");
    await writeFile(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)))\n");
    const args = ["space value", "a&b", "(group)", "caret^value"];
    let command = process.execPath;
    let commandArgs = [script, ...args];
    if (process.platform === "win32") {
      command = join(specialDirectory, "literal args.cmd");
      await writeFile(command, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
      commandArgs = args;
    }
    const result = await execute(command, commandArgs, { cwd: specialDirectory });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
  } finally {
    await workspace.cleanup();
  }
});

test("deployment workspaces are concurrent and preserve unrelated data", async () => {
  const protectedWorkspace = await createDeploymentWorkspace();
  const protectedRoot = protectedWorkspace.path;
  const legacyDirectory = join(protectedRoot, ".deployment-verification");
  await mkdir(legacyDirectory);
  const protectedFile = join(legacyDirectory, "sentinel.txt");
  await writeFile(protectedFile, "keep");
  const [first, second] = await Promise.all([
    createDeploymentWorkspace(),
    createDeploymentWorkspace(),
  ]);
  assert.notEqual(first.path, second.path);

  try {
    await writeFile(join(first.path, "first.txt"), "first");
    await writeFile(join(second.path, "second.txt"), "second");
    await symlink(protectedRoot, join(first.path, "protected-link"), "junction");
    await first.cleanup();
    await assert.rejects(access(first.path));
    assert.equal(await readFile(protectedFile, "utf8"), "keep");
    assert.equal(await readFile(join(second.path, "second.txt"), "utf8"), "second");
    assert.match(basename(second.path), /^potential-guide-deployment-/);
  } finally {
    await first.cleanup();
    await second.cleanup();
    await protectedWorkspace.cleanup();
  }
});
