import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildTask, toTaskSchema } from "@potential-guide/pguide-task-bundle";
import {
  inspectTaskArtifact,
  readTaskArtifact,
} from "@potential-guide/pguide-task-bundle/artifact";
import { createTaskEngine, newId } from "@potential-guide/task-engine";
import { MemoryIpfsClient, MemoryStore, VirtualClock } from "@potential-guide/task-engine/testing";
import { compileJsonSchema } from "@potential-guide/task-protocol";
import type { TaskContext } from "@potential-guide/task-sdk";
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
const page = "---\ntitle: Page\ndescription: Description\n---\n";

test("strict result contracts, runtime code enforcement and inferred literal types", () => {
  const schema = compileJsonSchema(toTaskSchema(createCheckResultSchema(codes)));
  for (const value of [
    { pass: true },
    { pass: false, problems: [{ target: "text", code: "text-empty", actual: null }] },
  ])
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
  assert.deepEqual(createCheckResult(codes, []), { pass: true });
  schema.validate(
    createCheckResult(codes, [{ target: "😀".repeat(4096), code: "text-empty", actual: null }]),
  );
  assert.throws(
    () =>
      createCheckResult(codes, [{ target: "😀".repeat(4097), code: "text-empty", actual: null }]),
    /Invalid Check problem/,
  );
  assert.deepEqual(createCheckResult(codes, [{ target: "x", code: "text-empty", actual: "" }]), {
    pass: false,
    problems: [{ target: "x", code: "text-empty", actual: "" }],
  });
  assert.throws(() => {
    // @ts-expect-error YAML-derived literal codes reject unknown business codes.
    createCheckResult(codes, [{ target: "x", code: "unknown", actual: null }]);
  }, /Undeclared/);
  assert.throws(() => {
    // @ts-expect-error Empty declarations cannot produce any problems.
    createCheckResult([] as const, [{ target: "x", code: "anything", actual: null }]);
  }, /Undeclared/);
  const zero = compileJsonSchema(toTaskSchema(createCheckResultSchema([] as const)));
  zero.validate({ pass: true });
  assert.throws(() => zero.validate({ pass: false, problems: [] }));
  const contract = createCheckContract(Type.Object({ value: Type.String() }), codes);
  assert.deepEqual(toTaskSchema(contract.message), { not: {} });
});

test("callback preserves context, logs, faults, cleanup and cancellation identity", async () => {
  const controller = new AbortController();
  const logs: unknown[] = [];
  const context = {
    signal: controller.signal,
    log: async (value: unknown) => {
      logs.push(value);
    },
  } as unknown as TaskContext;
  const callback = createCheckTask(codes, async (input: { text: string }, received) => {
    assert.equal(received, context);
    await received.log({ level: "info", message: input.text });
    return [];
  });
  assert.deepEqual(await callback({ text: "ok" }, context), { pass: true });
  assert.equal(logs.length, 1);
  const fault = new Error("business fault");
  let cleaned = false;
  await assert.rejects(
    createCheckTask(codes, async () => {
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
    createCheckTask(codes, async () => {
      controller.abort(reason);
      return [];
    })({}, context),
    (error) => error === reason,
  );
  let called = false;
  await assert.rejects(
    createCheckTask(codes, async () => {
      called = true;
      return [];
    })({}, context),
    (error) => error === reason,
  );
  assert.equal(called, false);
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
      async (_dir, config) => {
        const mapping = config.references.en;
        assert.ok(mapping);
        mapping.problems["text-empty"] = "references/en/problems/wrong.md";
      },
    ],
    [
      "unknown language mapping",
      async (_dir, config) => {
        const mapping = config.references.en;
        assert.ok(mapping);
        config.references.fr = mapping;
      },
    ],
    [
      "unknown problem",
      async (_dir, config) => {
        const mapping = config.references.en;
        assert.ok(mapping);
        mapping.problems.unknown = "references/en/problems/unknown.md";
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
        config.references["zh-CN"] = {
          check: "references/zh-CN/check.md",
          problems: { "text-empty": "references/zh-CN/problems/text-empty.md" },
        };
      }
      if (mode === "zero") {
        config.problemCodes = [];
        config.references.en.problems = {};
        await rm(join(directory, "references/en/problems"), { recursive: true });
        await writeFile(
          join(directory, "src/main.ts"),
          `import {createCheckTask} from "@potential-guide/check-sdk";import {runTask} from "@potential-guide/task-sdk";import {problemCodes} from "../dist/definitions/text.js";runTask(createCheckTask(problemCodes,async()=>[]));`,
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
  assert.deepEqual(
    Object.keys(result.metafile?.inputs ?? {}).map((path) =>
      path.replaceAll("\\", "/").split("/").at(-1),
    ),
    ["definition.ts", "index.ts"],
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
    await engine.start();
    for (const [text, expected] of [
      ["hello", { pass: true }],
      [" ", { pass: false, problems: [{ target: "text", code: "text-empty", actual: " " }] }],
    ] as const) {
      const requestId = newId(clock.now());
      await engine.submit({ requestId, bundle: built.cid, timeoutMs: 10000, text }, caller);
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
      assert.deepEqual(task.result, expected);
    }
  } finally {
    await engine.close();
    await rm(directory, { recursive: true, force: true });
  }
});
