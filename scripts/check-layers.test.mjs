import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { allowed, checkLayers, classify, imports } from "./check-layers.mjs";

const policy = {
  protocol: ["protocol", "primitives"],
  business: ["business", "other-business"],
  tools: ["tool", "other-tool"],
  deferredExternalization: ["@potential-guide/git-source", "concrete"],
};

test("only three layers, downward/direct protocol and same-layer dependencies are allowed", () => {
  const { layers, errors } = classify(policy, Object.values(policy).flat());
  assert.deepEqual(errors, []);
  for (const [from, to] of [
    ["tool", "business"],
    ["tool", "protocol"],
    ["business", "protocol"],
    ["protocol", "primitives"],
    ["business", "other-business"],
    ["tool", "other-tool"],
    ["tool", "@potential-guide/git-source"],
  ])
    assert.equal(allowed(layers, from, to), true);
  for (const [from, to] of [
    ["protocol", "business"],
    ["protocol", "tool"],
    ["business", "tool"],
    ["business", "@potential-guide/git-source"],
    ["tool", "concrete"],
    ["protocol", "concrete"],
  ]) {
    assert.equal(allowed(layers, from, to), false);
  }
  assert.match(
    classify(policy, [...Object.values(policy).flat(), "unknown"]).errors.join(),
    /Unclassified/,
  );
  assert.match(
    classify({ ...policy, protocol: ["tool"] }, Object.values(policy).flat()).errors.join(),
    /Duplicate/,
  );
});

test("parser includes type imports, reexports, dynamic imports, import types and require", () => {
  assert.deepEqual(
    imports(`
    import type { X } from "one";
    export type { X } from "two";
    export * from "three";
    const x = import("four");
    type Y = import("five").Y;
    const z = require("six");
    import q = require("seven");
    // import "not-code"
  `),
    ["one", "two", "three", "four", "five", "six", "seven"],
  );
});

test("manifest and cross-package source paths cannot bypass reverse dependency checks", async () => {
  await mkdir(".cache", { recursive: true });
  const root = await mkdtemp(join(".cache", "layer-test-"));
  try {
    await mkdir(join(root, "config"));
    await writeFile(
      join(root, "config", "package-layers.json"),
      JSON.stringify({
        protocol: ["low"],
        business: ["mid"],
        tools: ["high"],
        deferredExternalization: [],
      }),
    );
    for (const name of ["low", "mid", "high"]) {
      await mkdir(join(root, "packages", name, "src"), { recursive: true });
      await writeFile(join(root, "packages", name, "package.json"), JSON.stringify({ name }));
    }
    await writeFile(
      join(root, "packages", "high", "src", "ok.ts"),
      'export type { X } from "low";',
    );
    assert.deepEqual(await checkLayers(root), []);
    await writeFile(
      join(root, "packages", "low", "src", "bad.ts"),
      'import type { X } from "../../high/src/x.js"; export * from "mid";',
    );
    await writeFile(
      join(root, "packages", "mid", "package.json"),
      JSON.stringify({ name: "mid", optionalDependencies: { high: "workspace:^" } }),
    );
    const errors = await checkLayers(root);
    assert.equal(errors.length, 3, errors.join("\n"));
    assert.ok(errors.some((error) => error.includes("optionalDependencies")));
    assert.ok(errors.some((error) => error.includes("low -> high")));
    assert.ok(errors.some((error) => error.includes("low -> mid")));
    await writeFile(join(root, "packages", "low", "src", "bad.ts"), "");
    await writeFile(
      join(root, "packages", "low", "src", "contract.d.ts"),
      'export type { X } from "../../high/src/contract.js";',
    );
    await writeFile(
      join(root, "packages", "mid", "package.json"),
      JSON.stringify({ name: "mid", peerDependencies: { alias: "npm:high@1.0.0" } }),
    );
    const aliases = await checkLayers(root);
    assert.equal(aliases.length, 2, aliases.join("\n"));
    assert.ok(aliases.some((error) => error.includes("contract.d.ts")));
    assert.ok(aliases.some((error) => error.includes("peerDependencies")));
    await writeFile(join(root, "packages", "low", "src", "contract.d.ts"), "");
    await writeFile(join(root, "packages", "mid", "package.json"), JSON.stringify({ name: "mid" }));
    await writeFile(join(root, "packages", "high", "src", "contract.ts"), "export interface X {}");
    await writeFile(
      join(root, "packages", "low", "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@upper": ["../high/src/contract.ts"] } },
      }),
    );
    await writeFile(
      join(root, "packages", "low", "src", "bad.ts"),
      'import type { X } from "@upper";',
    );
    const paths = await checkLayers(root);
    assert.equal(paths.length, 1, paths.join("\n"));
    assert.match(paths[0], /low -> high/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
