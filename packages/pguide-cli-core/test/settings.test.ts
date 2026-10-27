import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import {
  editConfig,
  extractGlobals,
  inspectSettings,
  loadConfig,
  loadSettingsCatalog,
  parseConfig,
  registerSettingsPackage,
  settingsPackagesPath,
  unregisterSettingsPackage,
  userConfigPath,
} from "../src/index.js";

const scratch = resolve(import.meta.dirname, "../../../.cache");
await mkdir(scratch, { recursive: true });

test("metadata core imports do not initialize parsers, settings validators or the AHP SDK", () => {
  const hook = `
    export function resolve(specifier, context, next) {
      if (specifier.startsWith("@microsoft/agent-host-protocol") ||
          specifier.includes("built-in-settings") ||
          ["yaml", "jsonc-parser", "ajv"].includes(specifier))
        throw new Error("Unexpected eager import: " + specifier);
      return next(specifier, context);
    }
  `;
  const entry = new URL("../dist/index.js", import.meta.url).href;
  execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    `
      import { register, createRequire } from "node:module";
      import { sep } from "node:path";
      register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(hook)}`)});
      await import(${JSON.stringify(entry)});
      const cache = createRequire(${JSON.stringify(entry)}).cache;
      for (const path of Object.keys(cache))
        if (["yaml", "jsonc-parser", "ajv"].some(name => path.includes(sep + name + sep)))
          throw new Error("Unexpected eager require: " + path);
    `,
  ]);
});

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const cwd = await mkdtemp(join(scratch, "settings-"));
  const before = { ...process.env };
  process.env.APPDATA = join(cwd, "user");
  process.env.XDG_CONFIG_HOME = join(cwd, "user");
  for (const name of ["PGUIDE_FORMAT", "PGUIDE_LANGUAGE", "PGUIDE_STATE_DIRECTORY"])
    delete process.env[name];
  await mkdir(dirname(userConfigPath()), { recursive: true });
  await mkdir(join(cwd, ".pguide"));
  t.after(async () => {
    process.env = before;
    await rm(cwd, { recursive: true, force: true });
  });
  return { cwd, user: userConfigPath(), project: join(cwd, ".pguide", "config.jsonc") };
}

test("JSONC full IDs, duplicate keys at every depth, legacy and syntax rejection", () => {
  assert.deepEqual(parseConfig('// header\n{"custom.object": {"a":1,},}'), {
    "custom.object": { a: 1 },
  });
  for (const source of [
    '{"pilot.probe":1,"pilot.probe":2}',
    '{"custom.object":{"a":1,"a":2}}',
    '{"schemaVersion":2}',
    "schemaVersion: 2",
    "[]",
    "",
    '{"custom.object": NaN}',
    '{"bad namespace.value": true}',
  ])
    assert.throws(() => parseConfig(source));
});

test("whole-value shallow merge, nearest project, static defaults and provenance without writes", async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.user,
    JSON.stringify({
      "objectives.aliases": { inherited: "user" },
      "custom.list": [1, 2],
      "custom.object": { a: 1, b: 2 },
    }),
  );
  const source =
    '{ // preserve\n"objectives.aliases": {}, "custom.list": [3], "custom.object": {"a":4}\n}';
  await writeFile(f.project, source);
  const nested = join(f.cwd, "nested", "child");
  await mkdir(nested, { recursive: true });
  const loaded = await loadConfig(nested);
  assert.deepEqual(loaded.value["objectives.aliases"], {});
  assert.deepEqual(loaded.value["custom.list"], [3]);
  assert.deepEqual(loaded.value["custom.object"], { a: 4 });
  assert.equal(loaded.value["regulate.agentTimeoutMs"], 1800000);
  assert.equal(loaded.value["supervise.agentTimeoutMs"], undefined);
  assert.equal(loaded.value["pguide.diagnoseAhpTimeoutMs"], 30000);
  assert.equal(loaded.value["agents.defaultAgent"], undefined);
  assert.equal(loaded.sources["custom.object"], f.project);
  assert.match(loaded.sources["regulate.agentTimeoutMs"] ?? "", /^default:/);
  assert.equal(await readFile(f.project, "utf8"), source);
  assert.equal(loaded.paths.project, f.project);
  assert.equal(loaded.files.length, 2);
  assert.ok(loaded.unverified.length > 0);
});

test("selected-layer errors cannot hide behind overrides, unrelated semantic errors stay isolated", async (t) => {
  const f = await fixture(t);
  await writeFile(f.user, '{"regulate.agentTimeoutMs": 0}');
  await writeFile(f.project, '{"regulate.agentTimeoutMs": 100}');
  assert.equal((await loadConfig(f.cwd, ["pguide"])).value["regulate.agentTimeoutMs"], 100);
  await assert.rejects(loadConfig(f.cwd, ["regulate"]), /Invalid configuration/);
  await assert.rejects(loadConfig(f.cwd), /Invalid configuration/);
  await writeFile(f.project, '{"custom.bad": 1, "custom.bad": 2}');
  await assert.rejects(loadConfig(f.cwd, ["pguide"]), /Duplicate/);
});

test("explicit objects are never completed by defaults; known unknown keys and permission semantics fail", async (t) => {
  await fixture(t);
  const catalog = await loadSettingsCatalog();
  for (const value of [
    { "pilot.probe": { timeoutMs: 10 } },
    { "regulate.quota": { maxAgentRuns: 1 } },
    { "regulate.permissions": { ceiling: [], grants: ["missing"] } },
    { "pilot.notASetting": true },
    { "regulate.agentTimeoutMs": 2147483648 },
    { "objectives.aliases": { "bad/name": "x" } },
  ])
    assert.ok(inspectSettings(value, "fixture", catalog).issues.length);
  assert.equal(inspectSettings({ "new-package.flag": true }, "fixture", catalog).issues.length, 0);
  const literal = parseConfig(
    '{"pilot.probe":{"__proto__":{"timeoutMs":90,"retry":{"maxRetries":0,"delayMs":0}}}}',
  );
  assert.deepEqual(Object.keys(literal["pilot.probe"] as object), ["__proto__"]);
  assert.ok(inspectSettings(literal, "fixture", catalog).issues.length);
});

test("comments and untouched key order survive complete-ID edits and removal", () => {
  const source = '{\n // keep A\n "custom.a": 1,\n // keep B\n "custom.b": {"x": 2},\n}\n';
  const next = editConfig(source, "custom.a", { replacement: true });
  assert.match(next, /\/\/ keep B\n "custom.b": \{"x": 2\}/);
  assert.ok(next.indexOf('"custom.a"') < next.indexOf('"custom.b"'));
  assert.deepEqual(parseConfig(editConfig(next, "custom.a", undefined)), { "custom.b": { x: 2 } });
});

test("removal deletes only the property and separator across positions, comments and line endings", async (t) => {
  for (const eol of ["\n", "\r\n"])
    for (const block of [false, true])
      for (const trailing of [false, true])
        for (const position of ["only", "first", "middle", "last"]) {
          await t.test(
            `${JSON.stringify(eol)} block=${block} trailing=${trailing} ${position}`,
            () => {
              const ids = position === "only" ? ["custom.a"] : ["custom.a", "custom.b", "custom.c"];
              const index = position === "middle" ? 1 : position === "last" ? 2 : 0;
              const id = ids[index] as string;
              const value = { nested: [1, 2], text: "commas, // and /* strings */" };
              const comment = (label: string) => (block ? `/* ${label} */` : `// ${label}`);
              const property = (key: string) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
              const source = [
                "{",
                ...ids.flatMap((key, i) => [
                  `  ${comment(`before-${key}`)}`,
                  `  ${property(key)}`,
                  `  ${comment(`after-${key}`)}`,
                  `  ${i < ids.length - 1 || trailing ? "," : ""} ${comment(`separator-${key}`)}`,
                ]),
                "}",
                "",
              ].join(eol);
              let expected = source.replace(property(id), "");
              const separator = index < ids.length - 1 || trailing ? index : index - 1;
              if (separator >= 0) {
                const marker = comment(`separator-${ids[separator]}`);
                expected = expected.replace(`, ${marker}`, ` ${marker}`);
              }
              const removed = editConfig(source, id, undefined);
              assert.equal(removed, expected);
              assert.deepEqual(
                parseConfig(removed),
                Object.fromEntries(ids.filter((key) => key !== id).map((key) => [key, value])),
              );
              assert.equal(editConfig(source, "custom.missing", undefined), source);
            },
          );
        }
});

test("environment sources retained, missing files allowed, legacy presence never skipped", async (t) => {
  const f = await fixture(t);
  process.env.PGUIDE_STATE_DIRECTORY = join(f.cwd, "state");
  const empty = await loadConfig(f.cwd);
  assert.deepEqual(empty.files, []);
  assert.equal(empty.value["cli-core.stateDirectory"], process.env.PGUIDE_STATE_DIRECTORY);
  assert.equal(empty.sources["cli-core.stateDirectory"], "environment");
  const child = join(f.cwd, "child");
  await mkdir(join(child, ".pguide"), { recursive: true });
  await writeFile(f.project, "{}");
  await writeFile(join(child, ".pguide", "config.yaml"), "schemaVersion: 2");
  await assert.rejects(loadConfig(child), /Legacy main configuration/);
  await writeFile(join(child, ".pguide", "config.jsonc"), "{}");
  await assert.rejects(loadConfig(child), /alongside config.jsonc/);
});

test("explicit local static registration, same-identity upgrades, conflicts and missing-package recovery", async (t) => {
  const f = await fixture(t);
  const root = join(f.cwd, "extension");
  await mkdir(root);
  const metadata = {
    name: "@fixture/custom",
    pguide: { settings: "./settings.json" },
    main: "./must-not-execute.js",
  };
  await writeFile(join(root, "package.json"), JSON.stringify(metadata));
  await writeFile(join(root, "must-not-execute.js"), "throw new Error('extension executed')");
  const description = (value: number) => ({
    schemaVersion: 1,
    namespace: "custom",
    settings: {
      "custom.answer": {
        description: "Answer",
        schema: { type: "integer", minimum: 0 },
        default: value,
      },
    },
  });
  await writeFile(join(root, "settings.json"), JSON.stringify(description(1)));
  await registerSettingsPackage(root);
  await registerSettingsPackage(root);
  assert.equal((await loadConfig(f.cwd)).value["custom.answer"], 1);
  assert.equal(JSON.parse(await readFile(settingsPackagesPath(), "utf8")).packages.length, 1);
  await writeFile(join(root, "settings.json"), JSON.stringify(description(2)));
  assert.equal((await loadConfig(f.cwd)).value["custom.answer"], 2);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ ...metadata, name: "@fixture/changed" }),
  );
  await assert.rejects(loadConfig(f.cwd, []), /identity or namespace changed/);
  await writeFile(join(root, "package.json"), JSON.stringify(metadata));
  await writeFile(
    join(root, "settings.json"),
    JSON.stringify({ ...description(1), namespace: "pilot" }),
  );
  await assert.rejects(loadConfig(f.cwd, []), /identity or namespace changed/);
  await rm(root, { recursive: true });
  await assert.rejects(loadConfig(f.cwd, []), /missing/);
  await unregisterSettingsPackage(root);
  await loadConfig(f.cwd);
  await writeFile(settingsPackagesPath(), "{bad");
  await assert.rejects(loadConfig(f.cwd, []), /Invalid settings registry/);
});

test("retired overlays reject both spellings but not payload after --", () => {
  for (const args of [["--config", "x"], ["--config=x"]])
    assert.throws(() => extractGlobals(args), /retired/);
  assert.deepEqual(extractGlobals(["--", "--config=x"]).rest, ["--", "--config=x"]);
});

test("registration rejects owner collisions, invalid defaults, external refs and escaping descriptor paths", async (t) => {
  const f = await fixture(t);
  const root = join(f.cwd, "extension");
  await mkdir(root);
  const metadata = { name: "@fixture/conflict", pguide: { settings: "./settings.json" } };
  await writeFile(join(root, "package.json"), JSON.stringify(metadata));
  for (const [description, message] of [
    [{ schemaVersion: 1, namespace: "pilot", settings: {} }, /namespace conflict/],
    [
      {
        schemaVersion: 1,
        namespace: "fixture",
        settings: {
          "fixture.bad": { description: "Bad", schema: { type: "integer" }, default: "bad" },
        },
      },
      /Invalid static default/,
    ],
    [
      {
        schemaVersion: 1,
        namespace: "fixture",
        settings: {
          "fixture.bad": {
            description: "External",
            schema: { $ref: "https://example.invalid/schema" },
          },
        },
      },
      /Invalid local schema/,
    ],
    [
      {
        schemaVersion: 1,
        namespace: "fixture",
        settings: {
          "fixture.bad": {
            description: "Async validation is not a settings contract",
            schema: { $async: true, type: "integer" },
            default: "bad",
          },
        },
      },
      /validate synchronously/,
    ],
  ] as const) {
    await writeFile(join(root, "settings.json"), JSON.stringify(description));
    await assert.rejects(registerSettingsPackage(root), message);
  }
  await writeFile(join(f.cwd, "outside.json"), "{}");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ ...metadata, pguide: { settings: "../outside.json" } }),
  );
  await assert.rejects(registerSettingsPackage(root), /stay inside/);
  await assert.rejects(readFile(settingsPackagesPath()), { code: "ENOENT" });
});
