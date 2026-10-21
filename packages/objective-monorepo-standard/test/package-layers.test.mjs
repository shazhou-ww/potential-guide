import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { captureFilesystemObservation } from "@potential-guide/objective-pilot";
import ts from "typescript";
import { stringify } from "yaml";
import { sourceImports } from "../src/imports.ts";
import {
  allowed,
  checkPackageLayers,
  classify,
  observePackageLayers,
} from "../src/package-layers.ts";
import { recorder } from "../src/report.ts";
import { observeRepository } from "../src/repository-observation.ts";
import { Snapshot } from "../src/shared.ts";
import { typeScriptHost } from "../src/typescript-host.ts";

const imports = (source) => sourceImports("source.ts", source).map(({ specifier }) => specifier);
async function checkLayers(root) {
  return (await checkPackageLayers(root)).findings
    .filter(({ state }) => state === "fail" || state === "unverified")
    .map(({ location, evidence }) => `${location}: ${evidence}`);
}

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
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages: [packages/*]");
    await writeFile(join(root, "turbo.json"), JSON.stringify({ tasks: {} }));
    await writeFile(
      join(root, "package-layers.yaml"),
      stringify({
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
    await writeFile(
      join(root, "packages", "low", "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@upper": ["../high/src/contract.ts"] },
          unknownLegacyOption: true,
        },
      }),
    );
    const legacy = await checkLayers(root);
    assert.equal(legacy.length, 1, legacy.join("\n"));
    assert.match(legacy[0], /low -> high/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid and missing YAML policies fail explicitly", async () => {
  await mkdir(".cache", { recursive: true });
  const root = await mkdtemp(join(".cache", "layer-policy-"));
  try {
    const policyPath = join(root, "package-layers.yaml");
    assert.match((await checkLayers(root)).join(), /ENOENT/);
    for (const value of [
      "protocol: [",
      "protocol: []\nprotocol: []\nbusiness: []\ntools: []",
      "protocol: wrong\nbusiness: []\ntools: []",
      "protocol: []\nbusiness: []\ntools: []\nunknown: []",
      "[]",
      "null",
      "protocol: []",
    ]) {
      await writeFile(policyPath, value);
      const report = await checkPackageLayers(root);
      assert.equal(report.state, "fail", value);
      assert.equal(report.findings[0].rule, "package-layer-policy", value);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace discovery uses pnpm patterns, not a hard-coded packages directory", async () => {
  await mkdir(".cache", { recursive: true });
  const root = await mkdtemp(join(".cache", "layer-workspaces-"));
  try {
    await writeFile(join(root, "package.json"), '{"name":"fixture"}');
    await writeFile(
      join(root, "pnpm-workspace.yaml"),
      "packages: [modules/*, apps/*, '!modules/excluded']",
    );
    await writeFile(join(root, "turbo.json"), '{"tasks":{}}');
    await writeFile(
      join(root, "package-layers.yaml"),
      "protocol: [low]\nbusiness: []\ntools: [high]",
    );
    for (const [directory, name] of [
      ["modules/low", "low"],
      ["apps/high", "high"],
      ["modules/excluded", "excluded"],
    ]) {
      await mkdir(join(root, directory), { recursive: true });
      await writeFile(join(root, directory, "package.json"), JSON.stringify({ name }));
    }
    assert.deepEqual(await checkLayers(root), []);
    await writeFile(
      join(root, "modules", "low", "package.json"),
      '{"name":"low","dependencies":{"alias":"link:../../apps/high"}}',
    );
    assert.match((await checkLayers(root)).join(), /low -> high/);
    await writeFile(join(root, "modules", "low", "package.json"), '{"name":"low"}');
    await writeFile(
      join(root, "modules", "low", "source.ts"),
      'type X = import("../../apps/high/source.js").X;',
    );
    assert.match((await checkLayers(root)).join(), /low -> high/);
    await writeFile(join(root, "modules", "low", "source.ts"), "export {};");
    await writeFile(join(root, "modules", "low", "tsconfig.json"), "{");
    assert.match((await checkLayers(root)).join(), /Invalid TypeScript configuration/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TypeScript extends, globs and alias resolution remain bound to captured facts, not live ts.sys", async (t) => {
  await mkdir(".cache", { recursive: true });
  const directory = await mkdtemp(join(resolve(".cache"), "layer-view-"));
  const root = await realpath(directory);
  try {
    await writeFile(join(root, "package.json"), '{"name":"fixture"}');
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages: [packages/*]");
    await writeFile(join(root, "turbo.json"), '{"tasks":{}}');
    await writeFile(
      join(root, "package-layers.yaml"),
      "protocol: [low]\nbusiness: []\ntools: [high]",
    );
    for (const name of ["low", "high"]) {
      await mkdir(join(root, "packages", name, "src"), { recursive: true });
      await writeFile(join(root, "packages", name, "package.json"), JSON.stringify({ name }));
    }
    await mkdir(join(root, "configs"));
    const base = join(root, "configs", "base.json");
    const configuration = (name) =>
      JSON.stringify({
        compilerOptions: { baseUrl: "..", paths: { "@upper": [`packages/${name}/src/target.ts`] } },
      });
    await writeFile(
      base,
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(configuration("high"), "utf16le")]),
    );
    await writeFile(join(root, "configs", "utf8-bom.json"), `\uFEFF${configuration("low")}`);
    const bigEndian = Buffer.from(configuration("low"), "utf16le");
    bigEndian.swap16();
    await writeFile(
      join(root, "configs", "utf16-be.json"),
      Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian]),
    );
    const config = join(root, "packages", "low", "tsconfig.json");
    await writeFile(config, '{"extends":"../../configs/base.json"}');
    await writeFile(
      join(root, "packages", "low", "src", "index.ts"),
      'export type { X } from "@upper";',
    );
    await writeFile(join(root, "packages", "low", "src", "target.ts"), "export interface X {}");
    const target = join(root, "packages", "high", "src", "target.ts");
    await writeFile(target, "export interface X {}");
    const view = await captureFilesystemObservation(root, new AbortController().signal);
    assert.ok(view);
    const snapshot = new Snapshot(root, view);
    const host = await typeScriptHost(snapshot);
    for (const file of [
      base,
      join(root, "configs", "utf8-bom.json"),
      join(root, "configs", "utf16-be.json"),
    ])
      assert.equal(host.readFile(file), ts.sys.readFile(file));
    assert.deepEqual(
      host.readDirectory(root, [".ts"], [], ["packages/**"]).sort(),
      ts.sys.readDirectory(root, [".ts"], [], ["packages/**"]).sort(),
    );
    assert.throws(
      () => host.fileExists(join(root, "node_modules", "hidden.ts")),
      /input view boundary/,
    );
    assert.throws(
      () => host.readFile(join(root, "node_modules", "hidden.ts")),
      /input view boundary/,
    );
    const frozen = async () => {
      const output = recorder();
      const facts = await observeRepository(snapshot);
      try {
        for (const method of [
          "readFile",
          "fileExists",
          "readDirectory",
          "directoryExists",
          "getDirectories",
          "realpath",
        ]) {
          if (typeof ts.sys[method] === "function")
            t.mock.method(ts.sys, method, () => {
              throw new Error(`Unexpected live TypeScript filesystem call: ${method}`);
            });
        }
        await observePackageLayers(snapshot, facts, "package-layers.yaml", output.add);
      } finally {
        t.mock.restoreAll();
      }
      const problems = output
        .report(1)
        .findings.filter(({ state }) => state === "fail" || state === "unverified");
      assert.equal(problems.length, 1, JSON.stringify(problems));
      assert.equal(problems[0].rule, "package-layer-dependency");
      assert.match(problems[0].evidence, /low -> high/);
    };
    await rm(target);
    assert.deepEqual(await checkLayers(root), []);
    await frozen();
    await writeFile(target, "export interface X {}");
    await writeFile(base, configuration("low"));
    assert.deepEqual(await checkLayers(root), []);
    await frozen();
    const fresh = await captureFilesystemObservation(root, new AbortController().signal);
    assert.ok(fresh);
    const output = recorder();
    const refreshed = new Snapshot(root, fresh);
    await observePackageLayers(
      refreshed,
      await observeRepository(refreshed),
      "package-layers.yaml",
      output.add,
    );
    assert.equal(output.report(1).state, "pass");
    await mkdir(join(root, "node_modules", "config"), { recursive: true });
    await writeFile(
      join(root, "node_modules", "config", "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: "../..", paths: { "@upper": ["packages/high/src/target.ts"] } },
      }),
    );
    await writeFile(config, '{"extends":"../../node_modules/config/tsconfig.json"}');
    assert.match((await checkLayers(root)).join(), /low -> high/);
    const excluded = await captureFilesystemObservation(root, new AbortController().signal);
    assert.ok(excluded);
    const restricted = new Snapshot(root, excluded);
    const rejected = recorder();
    await observePackageLayers(
      restricted,
      await observeRepository(restricted),
      "package-layers.yaml",
      rejected.add,
    );
    assert.ok(
      rejected
        .report(1)
        .findings.some(
          ({ rule, state }) => rule === "package-layer-configuration" && state === "fail",
        ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
