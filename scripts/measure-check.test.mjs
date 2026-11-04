import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

for (const failing of [false, true])
  test(`measurement records ordered root stages and ${failing ? "propagates failure" : "ignores nested markers"}`, async (t) => {
    const cache = fileURLToPath(new URL("../.cache/", import.meta.url));
    await mkdir(cache, { recursive: true });
    const directory = await mkdtemp(join(cache, "measurement-harness-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: "measurement-fixture",
        version: "0.0.0",
        private: true,
        scripts: {
          check: "pnpm run sources:check && pnpm run test",
          "sources:check": "node -e \"console.log('source')\"",
          test: `pnpm run sources:check && node -e "process.exit(${failing ? 7 : 0})"`,
        },
      }),
    );
    const code = await new Promise((accept, reject) => {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("measure-check.mjs", import.meta.url)), directory, "fixture"],
        { stdio: "pipe" },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (!failing && code !== 0) reject(new Error(output));
        else accept(code);
      });
    });
    const result = JSON.parse(
      await readFile(join(directory, ".cache", "check-metrics", "fixture.json"), "utf8"),
    );
    assert.equal(result.code, code);
    assert.equal(code === 0, !failing);
    assert.deepEqual(
      result.stages.map(({ stage }) => stage),
      ["sources:check", "test"],
    );
    assert.ok(result.seconds > 0);
    assert.ok(result.stages.every(({ seconds }) => seconds >= 0));
  });
