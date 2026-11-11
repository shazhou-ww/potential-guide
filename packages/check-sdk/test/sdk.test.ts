import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildTask,
  inspectTaskArtifact,
  readTaskArtifact,
  toTaskSchema,
} from "@potential-guide/task-authoring";
import { createTaskEngine, newId } from "@silvermoon-work/task-engine";
import { MemoryIpfsClient, MemoryStore, VirtualClock } from "@silvermoon-work/task-engine/testing";
import { compileJsonSchema } from "@silvermoon-work/task-protocol";
import type { TaskContext } from "@silvermoon-work/task-sdk";
import { Type } from "@sinclair/typebox";
import { build } from "esbuild";
import { parse, stringify } from "yaml";
import {
  type CheckBuild,
  prepareCheck,
  validateReference,
  verifyCheckResources,
} from "../src/authoring.js";
import { createCheckContract, createCheckResultSchema } from "../src/contracts.js";
import { createCheckResult, createCheckTask } from "../src/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const codes = ["text-empty"] as const;
const languages = ["en", "zh-CN"] as const;
const cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gyz5l2v4vtwqgxx5lhh3mfxe";
const documentationContext = { cid, languages };
const documentation = (suffix = "check", root = cid, locales: readonly string[] = languages) =>
  Object.fromEntries(
    locales.map((language) => [
      language,
      `ipfs://${root}/resources/references/${language}/${suffix}.md`,
    ]),
  );
const result = (problems: { target: string; code: "text-empty"; actual: string | null }[]) =>
  createCheckResult(codes, problems, documentationContext);
const page = "---\ntitle: Page\ndescription: Description\n---\n";

test("strict result contracts, runtime code enforcement and inferred literal types", () => {
  const schema = compileJsonSchema(toTaskSchema(createCheckResultSchema(codes, languages)));
  for (const value of [result([]), result([{ target: "text", code: "text-empty", actual: null }])])
    schema.validate(value);
  for (const value of [
    { pass: true, problems: [] },
    { pass: false, problems: [] },
    { pass: false, problems: [{ target: "", code: "text-empty", actual: null }] },
    { pass: false, problems: [{ target: "x", code: "unknown", actual: null }] },
    { pass: false, problems: [{ target: "x", code: "text-empty", actual: 1 }] },
    { pass: false, problems: [{ target: "x", code: "text-empty", actual: null, extra: true }] },
    { pass: true, extra: true },
  ])
    assert.throws(() => schema.validate(value));
  assert.deepEqual(result([]), { pass: true, documentation: documentation() });
  schema.validate(result([{ target: "😀".repeat(4096), code: "text-empty", actual: null }]));
  assert.throws(
    () => result([{ target: "😀".repeat(4097), code: "text-empty", actual: null }]),
    /Invalid Check problem/,
  );
  assert.deepEqual(result([{ target: "x", code: "text-empty", actual: "" }]), {
    pass: false,
    documentation: documentation(),
    problems: [
      {
        target: "x",
        code: "text-empty",
        actual: "",
        documentation: documentation("problems/text-empty"),
      },
    ],
  });
  assert.throws(() => {
    createCheckResult(
      codes,
      // @ts-expect-error YAML-derived literal codes reject unknown business codes.
      [{ target: "x", code: "unknown", actual: null }],
      documentationContext,
    );
  }, /Undeclared/);
  assert.throws(() => {
    createCheckResult(
      [] as const,
      // @ts-expect-error Empty declarations cannot produce any problems.
      [{ target: "x", code: "anything", actual: null }],
      documentationContext,
    );
  }, /Undeclared/);
  const zero = compileJsonSchema(toTaskSchema(createCheckResultSchema([] as const, languages)));
  zero.validate({ pass: true, documentation: documentation() });
  assert.throws(() => zero.validate({ pass: false, problems: [] }));
  const contract = createCheckContract(Type.Object({ value: Type.String() }), codes, languages);
  assert.deepEqual(toTaskSchema(contract.message), { not: {} });
});

test("callback preserves context, logs, faults, cleanup and cancellation identity", async () => {
  const controller = new AbortController();
  const logs: unknown[] = [];
  const context = {
    signal: controller.signal,
    bundle: { cid },
    log: async (value: unknown) => {
      logs.push(value);
    },
  } as unknown as TaskContext;
  const callback = createCheckTask(codes, languages, async (input: { text: string }, received) => {
    assert.equal(received, context);
    await received.log({ level: "info", message: input.text });
    return [];
  });
  assert.deepEqual(await callback({ text: "ok" }, context), {
    pass: true,
    documentation: documentation(),
  });
  assert.equal(logs.length, 1);
  const fault = new Error("business fault");
  let cleaned = false;
  await assert.rejects(
    createCheckTask(codes, languages, async () => {
      try {
        throw fault;
      } finally {
        cleaned = true;
      }
    })({}, context),
    (error) => error === fault,
  );
  assert.equal(cleaned, true);
  const reason = new Error("stop");
  await assert.rejects(
    createCheckTask(codes, languages, async () => {
      controller.abort(reason);
      return [];
    })({}, context),
    (error) => error === reason,
  );
  let called = false;
  await assert.rejects(
    createCheckTask(codes, languages, async () => {
      called = true;
      return [];
    })({}, context),
    (error) => error === reason,
  );
  assert.equal(called, false);
});

test("documentation is mandatory, complete and reference-only on every node", () => {
  const schema = compileJsonSchema(toTaskSchema(createCheckResultSchema(codes, languages)));
  const good = result([{ target: "x", code: "text-empty", actual: null }]);
  assert.equal(good.pass, false);
  if (good.pass) throw new Error("Expected problems.");
  for (const invalid of [
    { ...good, documentation: {} },
    { ...good, documentation: { en: documentation().en } },
    { ...good, documentation: { ...documentation(), fr: documentation().en } },
    { ...good, documentation: { ...documentation(), en: "# Inline body" } },
    { ...good, documentation: documentation("problems/text-empty") },
    { ...good, documentation: { ...documentation(), en: documentation()["zh-CN"] } },
    { ...good, problems: [{ ...good.problems[0], documentation: documentation() }] },
    { ...good, problems: [{ ...good.problems[0], documentation: {} }] },
    { ...good, problems: [{ ...good.problems[0], actual: 1 }] },
    { ...good, problems: [{ ...good.problems[0], target: "" }] },
    { ...good, problems: [{ ...good.problems[0], code: "unknown" }] },
    { ...good, extra: true },
    { pass: true },
    { pass: true, documentation: documentation(), problems: [] },
  ])
    assert.throws(() => schema.validate(invalid));
  for (const cid of ["", "latest", "https://example.com/check.md", "bnotacid"])
    assert.throws(() => createCheckResult(codes, [], { cid, languages }));
  for (const languages of [[], ["en", "en"], ["en-us"], ["../en"]])
    assert.throws(() => createCheckResult(codes, [], { cid, languages }));
});

test("Reference frontmatter gates metadata only, never Markdown content", () => {
  for (const newline of ["\n", "\r\n", "\r"])
    validateReference(Buffer.from(page.replaceAll("\n", newline)), "page.md");
  for (const body of ["", "\n# Anything\n", "\n[broken](missing.md#none)\n", "\n[ref][id]\n"])
    validateReference(Buffer.from(page + body), "page.md");
  validateReference(
    Buffer.from(`---\ntitle: Unicode\ndescription: ${"😀".repeat(200)}\n---\n`),
    "unicode.md",
  );
  for (const text of [
    "",
    "# No metadata",
    "---\ntitle: x\n---\n",
    "---\ndescription: x\n---\n",
    "---\ntitle: ''\ndescription: x\n---\n",
    "---\ntitle: x\ndescription: 1\n---\n",
    "---\ntitle: x\ndescription: x\nreferences: []\n---\n",
    "---\ntitle: [bad\ndescription: x\n---\n",
    "---\ntitle: a\ntitle: b\ndescription: x\n---\n",
    `---\ntitle: x\ndescription: ${"😀".repeat(201)}\n---\n`,
  ])
    assert.throws(() => validateReference(Buffer.from(text), "bad.md"), /bad.md/);
});

async function fixture() {
  await mkdir(join(root, ".cache"), { recursive: true });
  const directory = await mkdtemp(join(root, ".cache", "author-"));
  await cp(join(root, "examples", "text"), directory, {
    recursive: true,
    filter: (path) => !path.endsWith("package.json") && !path.includes(`${join("text", "dist")}`),
  });
  return directory;
}

test("Check comparison shares text normalization and explicit raw binary selection", async () => {
  const directory = await fixture();
  try {
    const file = join(directory, "text.check.build.yaml");
    const config: CheckBuild = parse(await readFile(file, "utf8"));
    await writeFile(join(directory, "payload.bin"), Buffer.from([255, 13, 10, 0]));
    config.resources = [{ from: "payload.bin", to: "resources/payload.bin" }];
    config.binary = ["resources/*.bin"];
    await writeFile(file, stringify(config));
    let cid: string | undefined;
    for (const newline of ["\n", "\r\n", "\r"]) {
      await writeFile(join(directory, "references/en/check.md"), page.replaceAll("\n", newline));
      const prepared = await prepareCheck(file);
      const built = await buildTask(prepared.buildFile);
      cid ??= built.cid;
      assert.equal(built.cid, cid);
      const artifact = await readTaskArtifact(built.car);
      verifyCheckResources(prepared, artifact.files);
      assert.deepEqual(artifact.files.get("resources/payload.bin"), Buffer.from([255, 13, 10, 0]));
      const changed = new Map(artifact.files);
      changed.set("resources/payload.bin", Buffer.from([255, 10, 0]));
      assert.throws(() => verifyCheckResources(prepared, changed), /bytes differ/);
      changed.set("resources/payload.bin", artifact.files.get("resources/payload.bin")!);
      changed.set("resources/references/en/check.md", Buffer.from(`${page}changed\n`));
      assert.throws(() => verifyCheckResources(prepared, changed), /bytes differ/);
    }
    config.binary = ["resources/**"];
    await writeFile(file, stringify(config));
    await assert.rejects(prepareCheck(file), /check.json cannot be binary/);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("Check authoring rejects missing, misnamed, undeclared and invalid inputs", async () => {
  const changes: [string, (directory: string, config: CheckBuild) => Promise<void>][] = [
    [
      "definition",
      async (dir) => {
        await rm(join(dir, "references/en/check.md"));
      },
    ],
    [
      "problem",
      async (dir) => {
        await rm(join(dir, "references/en/problems/text-empty.md"));
      },
    ],
    [
      "filename",
      async (dir) => {
        await writeFile(join(dir, "references/en/problems/wrong.md"), page);
      },
    ],
    [
      "stale author references rejected",
      async (_dir, config) => {
        Object.assign(config, {
          references: { en: { check: "references/en/check.md", problems: {} } },
        });
      },
    ],
    [
      "unknown problem",
      async (dir) => {
        await writeFile(join(dir, "references/en/problems/unknown.md"), page);
      },
    ],
    [
      "unknown language file",
      async (dir) => {
        await mkdir(join(dir, "references/fr"), { recursive: true });
        await writeFile(join(dir, "references/fr/check.md"), page);
      },
    ],
    [
      "unknown empty language",
      async (dir) => {
        await mkdir(join(dir, "references/fr"), { recursive: true });
      },
    ],
    [
      "unknown problem file",
      async (dir) => {
        await writeFile(join(dir, "references/en/problems/unknown.md"), page);
      },
    ],
    [
      "noncanonical language",
      async (_dir, config) => {
        config.languages = ["EN"];
      },
    ],
    [
      "invalid language",
      async (_dir, config) => {
        config.languages = ["not_a_tag"];
      },
    ],
    [
      "duplicate language",
      async (_dir, config) => {
        config.languages = ["en", "en"];
      },
    ],
    [
      "no languages",
      async (_dir, config) => {
        config.languages = [];
      },
    ],
    [
      "duplicate code",
      async (_dir, config) => {
        config.problemCodes.push("text-empty");
      },
    ],
    [
      "unknown metadata",
      async (dir) => {
        await writeFile(
          join(dir, "references/en/check.md"),
          "---\ntitle: x\ndescription: x\nreferences: []\n---\n",
        );
      },
    ],
    [
      "missing frontmatter",
      async (dir) => {
        await writeFile(join(dir, "references/en/check.md"), "body");
      },
    ],
    [
      "illegal metadata",
      async (dir) => {
        await writeFile(
          join(dir, "references/en/check.md"),
          "---\ntitle: 42\ndescription: x\n---\n",
        );
      },
    ],
    [
      "escape",
      async (_dir, config) => {
        config.referenceRoot = "../references";
      },
    ],
    [
      "unknown field",
      async (_dir, config) => {
        Object.assign(config, { unknown: true });
      },
    ],
  ];
  for (const [name, change] of changes) {
    const directory = await fixture();
    try {
      const file = join(directory, "text.check.build.yaml");
      const config = parse(await readFile(file, "utf8"));
      await change(directory, config);
      await writeFile(file, stringify(config));
      await assert.rejects(prepareCheck(file), Error, name);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("single/multilanguage and zero-code authoring freeze exact resource bytes", async () => {
  for (const mode of ["single", "multiple", "zero"]) {
    const directory = await fixture();
    try {
      const file = join(directory, "text.check.build.yaml");
      const config = parse(await readFile(file, "utf8"));
      if (mode === "multiple") {
        config.languages.push("zh-CN");
        await cp(join(directory, "references/en"), join(directory, "references/zh-CN"), {
          recursive: true,
        });
      }
      if (mode === "zero") {
        config.problemCodes = [];
        await rm(join(directory, "references/en/problems"), { recursive: true });
        await writeFile(
          join(directory, "src/main.ts"),
          `import {createCheckTask} from "@potential-guide/check-sdk";import {runTask} from "@silvermoon-work/task-sdk";import {languages,problemCodes} from "../dist/definitions/text.js";runTask(createCheckTask(problemCodes,languages,async()=>[]));`,
        );
      }
      await writeFile(file, stringify(config));
      await writeFile(
        join(directory, "references/en/check.md"),
        mode === "zero" ? page : `${page}# Arbitrary section\n[broken](not-real.md)`,
      );
      const prepared = await prepareCheck(file);
      const before = Buffer.from(prepared.resources.get("resources/references/en/check.md") ?? []);
      await writeFile(join(directory, "references/en/check.md"), "invalid changed source");
      await writeFile(
        join(directory, "src/main.ts"),
        'throw new Error("live source must not run");',
      );
      const built = await buildTask(prepared.buildFile);
      const artifact = await readTaskArtifact(built.car);
      verifyCheckResources(prepared, artifact.files);
      assert.deepEqual(artifact.files.get("resources/references/en/check.md"), before);
      assert.equal(
        (await inspectTaskArtifact(artifact.files)).cid,
        (await inspectTaskArtifact((await readTaskArtifact(built.directory)).files)).cid,
      );
      const missing = new Map(artifact.files);
      missing.delete("resources/references/en/check.md");
      assert.throws(() => verifyCheckResources(prepared, missing), /selection/);
      const changed = new Map(artifact.files);
      changed.set("resources/references/en/check.md", Buffer.from("changed"));
      assert.throws(() => verifyCheckResources(prepared, changed), /bytes/);
      const extra = new Map(artifact.files);
      extra.set("resources/unvalidated.md", Buffer.from(page));
      assert.throws(() => verifyCheckResources(prepared, extra), /selection/);
      const worker = artifact.files.get("worker.cjs")?.toString() ?? "";
      assert.doesNotMatch(
        worker,
        /parseDocument|prepareCheck|createCheckContract|@sinclair\/typebox|yaml\/dist/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("runtime root import closure excludes schemas and authoring", async () => {
  const result = await build({
    entryPoints: [join(root, "src/index.ts")],
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
  });
  assert.doesNotMatch(
    Object.keys(result.metafile?.inputs ?? {}).join("\n"),
    /schema-runtime|authoring|contracts|typebox|ajv|yaml/,
  );
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import("@potential-guide/check-sdk").then(m=>console.log(Object.keys(m).sort().join(",")))',
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(output.trim(), "createCheckResult,createCheckTask");
});

test("independent Check standard scaffold executes pass/problem through Engine", async () => {
  const directory = await fixture();
  const clock = new VirtualClock();
  const ipfs = new MemoryIpfsClient();
  const engine = createTaskEngine({
    store: new MemoryStore(),
    clock,
    ipfsClient: ipfs,
    authorize: () => true,
  });
  const caller = { scope: "new-check", subject: "author" };
  try {
    const configFile = join(directory, "text.check.build.yaml");
    const config = parse(await readFile(configFile, "utf8")) as CheckBuild;
    config.languages = [...languages];
    config.problemCodes.push("text-invalid");
    for (const language of languages) {
      await mkdir(join(directory, `references/${language}/problems`), { recursive: true });
      await writeFile(
        join(directory, `references/${language}/check.md`),
        `${page}${language} check v1\n`,
      );
      for (const code of config.problemCodes)
        await writeFile(
          join(directory, `references/${language}/problems/${code}.md`),
          `${page}${language} ${code} v1\n`,
        );
    }
    await writeFile(configFile, stringify(config));
    const main = join(directory, "src/main.ts");
    await writeFile(
      main,
      (await readFile(main, "utf8")).replace(
        '[{ target: "text", code: "text-empty", actual: input.text }]',
        '[{ target: "text", code: "text-empty", actual: input.text }, { target: "text", code: "text-invalid", actual: null }]',
      ),
    );
    const prepared = await prepareCheck(join(directory, "text.check.build.yaml"));
    execFileSync(
      process.execPath,
      [
        fileURLToPath(import.meta.resolve("typescript/bin/tsc")),
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "NodeNext",
        "--target",
        "ES2023",
        join(directory, "src/main.ts"),
        join(directory, "src/contract.ts"),
      ],
      { cwd: root, stdio: "pipe" },
    );
    const built = await buildTask(prepared.buildFile);
    const artifact = await readTaskArtifact(built.car);
    verifyCheckResources(prepared, artifact.files);
    assert.equal(await ipfs.import(artifact.files), built.cid);
    await writeFile(join(directory, "references/en/check.md"), `${page}en check v2\n`);
    for (const code of config.problemCodes)
      await writeFile(
        join(directory, `references/en/problems/${code}.md`),
        `${page}en ${code} v2\n`,
      );
    const updatedPrepared = await prepareCheck(configFile);
    const updated = await buildTask(updatedPrepared.buildFile);
    const updatedArtifact = await readTaskArtifact(updated.car);
    verifyCheckResources(updatedPrepared, updatedArtifact.files);
    assert.notEqual(updated.cid, built.cid);
    assert.deepEqual(updatedArtifact.files.get("worker.cjs"), artifact.files.get("worker.cjs"));
    assert.equal(await ipfs.import(updatedArtifact.files), updated.cid);
    const published = new Map([
      [built.cid, artifact.files],
      [updated.cid, updatedArtifact.files],
    ]);
    // A caller receives only a detached node; it does not use problem codes or check.json.
    const readDocumentation = async (
      node: { documentation: Record<string, string> },
      language: string,
    ) => {
      const reference = node.documentation[language];
      if (!reference) throw new Error(`Unsupported documentation language: ${language}`);
      const uri = new URL(reference);
      const bytes = published.get(uri.hostname)?.get(uri.pathname.slice(1));
      if (!bytes) throw new Error(`Documentation unavailable: ${uri}`);
      return bytes.toString();
    };
    await engine.start();
    for (const version of [built, updated]) {
      for (const [text, expected] of [
        ["hello", { pass: true }],
        [
          " ",
          {
            pass: false,
            problems: [
              { target: "text", code: "text-empty", actual: " " },
              { target: "text", code: "text-invalid", actual: null },
            ],
          },
        ],
      ] as const) {
        const requestId = newId(clock.now());
        await engine.submit({ requestId, bundle: version.cid, timeoutMs: 10000, text }, caller);
        const status = await engine.getRequestStatus(requestId, { waitMs: 10000 }, caller);
        assert.equal(status.status, "accepted");
        if (status.status !== "accepted") throw new Error(JSON.stringify(status));
        engine.tick();
        const deadline = Date.now() + 10000;
        let task = engine.getTask(status.taskId, caller);
        while (!["completed", "failed", "stopped"].includes(task.stage)) {
          if (Date.now() > deadline) throw new Error("Independent Check timed out");
          await new Promise((resolve) => setTimeout(resolve, 10));
          task = engine.getTask(status.taskId, caller);
        }
        await engine.waitForTaskRelease(task.taskId, caller);
        assert.equal(task.stage, "completed", JSON.stringify(task.error));
        assert.deepEqual(task.result, {
          ...expected,
          documentation: documentation("check", version.cid),
          ...("problems" in expected
            ? {
                problems: expected.problems.map((problem) => ({
                  ...problem,
                  documentation: documentation(`problems/${problem.code}`, version.cid),
                })),
              }
            : {}),
        });
        const detached = structuredClone(task.result) as {
          pass: boolean;
          documentation: Record<string, string>;
          problems?: { code: string; documentation: Record<string, string> }[];
        };
        for (const language of languages) {
          assert.match(
            await readDocumentation(detached, language),
            new RegExp(
              `${language} check ${version.cid === built.cid || language !== "en" ? "v1" : "v2"}`,
            ),
          );
          for (const problem of detached.problems ?? [])
            assert.match(
              await readDocumentation(problem, language),
              new RegExp(
                `${language} ${problem.code} ${version.cid === built.cid || language !== "en" ? "v1" : "v2"}`,
              ),
            );
        }
        const unavailable = new Map(published);
        published.clear();
        await assert.rejects(
          readDocumentation(detached, "fr"),
          /Unsupported documentation language/,
        );
        await assert.rejects(readDocumentation(detached, "en"), /Documentation unavailable/);
        assert.deepEqual(detached, task.result);
        for (const [cid, files] of unavailable) published.set(cid, files);
      }
    }
  } finally {
    await engine.close();
    await rm(directory, { recursive: true, force: true });
  }
});
