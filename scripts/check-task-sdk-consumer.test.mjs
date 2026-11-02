import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { withoutAuthorDependencies } from "./check-task-sdk-consumer.mjs";

async function fixture(run) {
  const directory = resolve(".cache", `sdk-isolation-test-${randomUUID()}`);
  const dependency = join(directory, "node_modules", "@potential-guide", "task-sdk");
  await mkdir(dependency, { recursive: true });
  try {
    await writeFile(
      join(dependency, "package.json"),
      JSON.stringify({ type: "module", exports: "./index.js" }),
    );
    await writeFile(join(dependency, "index.js"), "export const fixture=true;");
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function dependencyProbe(directory) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'import("@potential-guide/task-sdk").then(()=>process.exit(0),error=>{console.error(error.code);process.exit(42)})',
      ],
      {
        cwd: directory,
        env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let diagnostics = "";
    child.stderr.on("data", (chunk) => {
      diagnostics += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, diagnostics }));
  });
}

test("SDK isolation has a positive dependency control and a real missing-module negative control", async () => {
  await fixture(async (directory) => {
    assert.equal((await dependencyProbe(directory)).code, 0);
    await withoutAuthorDependencies(directory, async () => {
      await assert.rejects(access(join(directory, "node_modules")), { code: "ENOENT" });
      const missing = await dependencyProbe(directory);
      assert.equal(missing.code, 42);
      assert.match(missing.diagnostics, /ERR_MODULE_NOT_FOUND/);
    });
    assert.equal((await dependencyProbe(directory)).code, 0);
  });
});

test("failed isolated consumption fails closed and restores the owned dependency directory", async () => {
  await fixture(async (directory) => {
    const failure = new Error("Intentional consumer failure.");
    await assert.rejects(
      withoutAuthorDependencies(directory, async () => {
        throw failure;
      }),
      (error) => error === failure,
    );
    assert.equal((await dependencyProbe(directory)).code, 0);
    await assert.rejects(access(join(directory, "author_modules")), { code: "ENOENT" });
  });
});
