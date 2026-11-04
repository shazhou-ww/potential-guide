import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
test("checked-in generated sources are guarded across builds and still explicitly validated", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.ok(scripts.check.startsWith("pnpm run sources:check && "));
  assert.ok(scripts.test.startsWith("pnpm run sources:check && pnpm run build && "));
  assert.match(scripts["sources:check"], /settings:check.*task-workers:check/);
  assert.match(scripts["sources:check"], /check-generated-sources\.mjs/);
  for (const scope of ["schemas", "self-check", "health", "monorepo", "setup", "workers"])
    assert.ok(scripts.test.includes(`${scope}:check`), `${scope} drift must remain checked`);
  assert.doesNotMatch(scripts.test, /workers:build/);
  assert.match(scripts.typecheck, /tsconfig\.test\.json/);
  assert.match(scripts.test, /--concurrency=2/);
});

test("each Objective build caches its staging tree and generator inputs", async () => {
  const { tasks } = JSON.parse(await readFile(new URL("turbo.json", root), "utf8"));
  for (const name of [
    "package-standard",
    "monorepo-standard",
    "setup-marker",
    "devbox-health",
    "pguide-setup",
    "pguide-self-check",
  ]) {
    const task = tasks[`@potential-guide/objective-${name}#build`];
    assert.ok(task.outputs.includes(`$TURBO_ROOT$/.staging/objective-${name}/**`));
    assert.ok(task.inputs.includes("$TURBO_ROOT$/scripts/build-*.mjs"));
    assert.ok(task.dependsOn.includes("^build"));
  }
});

test("structure checks cannot silently replace a requested consumer scope", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("scripts/check-packages.mjs", root)), "--structure", "--task-sdk"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Select only one consumer scope/);
});
