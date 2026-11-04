import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { type Json, taskSchemaUri } from "@potential-guide/task-protocol";
import { buildTaskBundle, compileTaskBundle } from "../src/build.js";
import { checkTaskArtifact } from "../src/artifact.js";
import { precompileCases } from "../../task-protocol/test/precompile-fixtures.js";
import { TypeSupervisor } from "../../task-engine/src/type-supervisor.js";

const declaration = {
  $schema: taskSchemaUri,
  name: "Precompiled",
  runtime: { type: "node", minVersion: "22.13.0" },
  entry: "worker.cjs",
  include: ["task.yaml", "worker.cjs"],
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", minLength: 2 } },
    required: ["text"],
    additionalProperties: false,
  },
  resultSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  messageSchema: false,
};
async function fixture(action: (directory: string) => Promise<void>) {
  const directory = resolve(".test-precompiled-sdk", randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function assertRuntimeOnly(metafile: Awaited<ReturnType<typeof compileTaskBundle>>["metafile"]) {
  const paths = Object.keys(metafile.inputs).map((path) => path.replaceAll("\\", "/"));
  assert.ok(!paths.some((path) => /schema-runtime|task-validator:/.test(path)));
  assert.ok(!paths.some((path) => /(?:ajv\/|fast-uri|multiformats)/.test(path)), paths.join("\n"));
  assert.ok(!paths.some((path) => /contract\.ts$/.test(path)));
  for (const output of Object.values(metafile.outputs))
    assert.ok(
      output.imports.every(
        (dependency) => !dependency.external || dependency.path.startsWith("node:"),
      ),
    );
}
async function executeWithEngine(
  built: Awaited<ReturnType<typeof buildTaskBundle>>,
  input: unknown,
  message?: unknown,
) {
  const { resolved } = await checkTaskArtifact(built.directory);
  const source = await readFile(join(built.directory, "worker.cjs"), "utf8");
  const frames: { kind: string; value?: unknown }[] = [];
  let release!: () => void,
    fail!: (error: Error) => void,
    exited = false;
  const done = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  const timer = setTimeout(() => fail(new Error("Engine Worker timed out.")), 10000);
  const supervisor = new TypeSupervisor(
    {
      type: built.cid,
      version: "1",
      environment: "authoring-test",
      ...resolved,
      bundle: { cid: built.cid, declaration: resolved },
      getBundleSource: () => source,
      async readBundle() {
        throw new Error("No resources in this fixture.");
      },
      module: "",
      exportName: "",
      configuration: {},
    },
    {
      async dispatch() {
        frames.push({ kind: "ready" });
      },
      async progress() {},
      async checkpoint() {},
      async complete(_id, result) {
        frames.push({ kind: "complete", value: result });
      },
      async failed(_id, error) {
        frames.push({ kind: "failed", value: error });
      },
      async confirm() {},
      async exited() {
        exited = true;
      },
      released() {
        release();
      },
      lost(_ids, error) {
        fail(new Error(error.message));
      },
    },
    { heartbeatMs: 20, healthMs: 5000, maxInFlight: 8, maxPayloadBytes: 65536 },
  );
  try {
    try {
      await supervisor.run("run", input as Json, "scope");
    } catch (error) {
      frames.push({
        kind: "failed",
        value: { code: (error as { code: string }).code, message: (error as Error).message },
      });
      return frames;
    }
    if (message !== undefined) {
      try {
        supervisor.message("run", {
          messageId: "message",
          taskId: "task",
          caller: { scope: "scope", subject: "actor" },
          payload: message as Json,
        });
      } catch (error) {
        supervisor.cancel("run");
        await done;
        throw error;
      }
    }
    await done;
    assert.equal(exited, true);
    return frames;
  } finally {
    clearTimeout(timer);
    await supervisor.close();
  }
}
async function execute(
  built: Awaited<ReturnType<typeof buildTaskBundle>>,
  input: unknown,
  message?: unknown,
  bundleOverride: { cid?: unknown; declaration?: unknown } = {},
) {
  if (!Object.keys(bundleOverride).length) return executeWithEngine(built, input, message);
  const generation = randomUUID();
  const { resolved } = await checkTaskArtifact(built.directory);
  const worker = new Worker(join(built.directory, "worker.cjs"), {
    execArgv: [],
    env: { NODE_OPTIONS: "" },
    workerData: {
      generation,
      maxInFlight: 8,
      maxPayloadBytes: 65536,
      bundle: { cid: built.cid, declaration: resolved, ...bundleOverride },
    },
  });
  const frames: { kind: string; value?: unknown }[] = [];
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Worker timed out: ${JSON.stringify(frames)}`)),
        10000,
      );
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else done();
      };
      worker.on("error", finish);
      worker.on("message", (frame) => {
        frames.push(frame);
        if (frame.kind === "ready") {
          worker.postMessage({ generation, kind: "run", runId: "run", scope: "scope", input });
          if (message !== undefined)
            worker.postMessage({
              generation,
              kind: "message",
              runId: "run",
              value: {
                taskId: "task",
                messageId: "message",
                caller: { scope: "scope", subject: "subject" },
                payload: message,
              },
            });
        }

        if (frame.id !== undefined) worker.postMessage({ generation, kind: "ack", id: frame.id });
        if (frame.kind === "released") finish();
      });
    });
  } finally {
    await worker.terminate();
  }
  return frames;
}

test("Worker treats the host-verified Bundle identity as opaque but checks configuration and declaration", async () => {
  await fixture(async (directory) => {
    const entry = join(directory, "main.ts");
    await writeFile(
      entry,
      `import {runTask} from "@potential-guide/task-sdk"; runTask(async input => input);`,
    );
    const built = await buildTaskBundle({
      declaration,
      entry,
      entryMode: "explicit",
      outDirectory: join(directory, "bundle"),
    });
    const cid = "host-verified-opaque-bundle-identity";
    const frames = await execute(built, { text: "okay" }, undefined, { cid });
    assert.deepEqual(frames.find((frame) => frame.kind === "ready")?.value, {
      $schema: declaration.$schema,
      cid,
      inputSchema: declaration.inputSchema,
      resultSchema: declaration.resultSchema,
      messageSchema: declaration.messageSchema,
    });
    assert.deepEqual(frames.find((frame) => frame.kind === "complete")?.value, { text: "okay" });
    for (const invalid of [undefined, null, 1, false, {}, "", "x".repeat(257)])
      await assert.rejects(execute(built, { text: "okay" }, undefined, { cid: invalid }), {
        message: "Invalid trusted Task Worker configuration.",
      });
    await assert.rejects(
      execute(built, { text: "okay" }, undefined, {
        cid,
        declaration: { ...declaration, name: "Different declaration" },
      }),
      { message: "Task Worker declaration differs from verified Bundle." },
    );
  });
});

test("explicit public SDK entry and arbitrary delegated wrapper start once and preserve validation", async () => {
  await fixture(async (directory) => {
    await writeFile(
      join(directory, "wrapper.ts"),
      `import {runTask} from "@potential-guide/task-sdk"; export function custom(callback) { runTask(callback); }`,
    );
    const entry = join(directory, "main.ts");
    const marker = join(directory, "executed.txt");
    await writeFile(
      entry,
      `import {custom} from "./wrapper.js";
import {appendFileSync} from "node:fs";
globalThis.Function = new Proxy(Function, {
  construct() { throw new Error("Runtime code generation is forbidden."); },
  apply() { throw new Error("Runtime code generation is forbidden."); },
});
custom(async input => {appendFileSync(${JSON.stringify(marker)}, "called\\n"); return input;});`,
    );
    const options = {
      declaration,
      entry,
      entryMode: "explicit" as const,
      outDirectory: join(directory, "bundle"),
    };
    const analyzed = await compileTaskBundle(options);
    assertRuntimeOnly(analyzed.metafile);
    await assert.rejects(readFile(marker), { code: "ENOENT" });
    const built = await buildTaskBundle(options);
    assert.deepEqual(
      await readFile(join(built.directory, "worker.cjs")),
      analyzed.contents.get("worker.cjs"),
    );
    for (const text of ["hello", "again"]) {
      const frames = await execute(built, { text });
      assert.equal(frames.filter((frame) => frame.kind === "ready").length, 1);
      assert.deepEqual(frames.find((frame) => frame.kind === "complete")?.value, { text });
    }
    const invalid = await execute(built, { text: 1 });
    assert.deepEqual(invalid.find((frame) => frame.kind === "failed")?.value, {
      code: "invalid_input",
      message: "Input does not satisfy inputSchema.",
    });

    assert.equal(await readFile(marker, "utf8"), "called\ncalled\n");
    const previous = await readFile(join(built.directory, "worker.cjs"));
    for (const field of ["inputSchema", "resultSchema", "messageSchema"]) {
      await assert.rejects(
        buildTaskBundle({
          ...options,
          declaration: { ...declaration, [field]: { $ref: "#/missing" } },
        }),
      );
      assert.deepEqual(await readFile(join(built.directory, "worker.cjs")), previous);
    }
    await assert.rejects(compileTaskBundle({ ...options, exportName: "default" }), /cannot select/);
  });
});

test("Engine rejects illegal results and messages, including Never, and the Worker releases", async () => {
  await fixture(async (directory) => {
    const entry = join(directory, "main.ts");
    await writeFile(
      entry,
      `import {runTask} from "@potential-guide/task-sdk"; runTask(async () => ({text: 1}));`,
    );
    let built = await buildTaskBundle({
      declaration,
      entry,
      entryMode: "explicit",
      outDirectory: join(directory, "result"),
    });
    const invalidResult = await execute(built, { text: "okay" });
    assert.deepEqual(invalidResult.find((frame) => frame.kind === "failed")?.value, {
      code: "invalid_input",
      message: "Input does not satisfy inputSchema.",
    });
    await writeFile(
      entry,
      `import {runTask} from "@potential-guide/task-sdk"; runTask(async (input, context) => {
      for await (const message of context.messages) { await message.accept(); return {text: message.payload.text}; }
      return input;
    });`,
    );
    for (const schema of [
      false,
      {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    ]) {
      built = await buildTaskBundle({
        declaration: { ...declaration, messageSchema: schema },
        entry,
        entryMode: "explicit",
        outDirectory: join(directory, schema === false ? "never" : "message"),
      });
      await assert.rejects(execute(built, { text: "okay" }, { text: 1 }), {
        message: "Input does not satisfy inputSchema.",
      });
      if (schema !== false) {
        const frames = await execute(built, { text: "okay" }, { text: "message" });
        assert.deepEqual(frames.find((frame) => frame.kind === "complete")?.value, {
          text: "message",
        });
      }
    }
  });
});

test("representative shared reference, sibling/composition, prototype and author validator opt-in", async () => {
  await fixture(async (directory) => {
    const entry = join(directory, "main.ts");
    await writeFile(
      entry,
      `import {runTask} from "@potential-guide/task-sdk"; runTask(async input => input);`,
    );
    const inputSchema = {
      type: "object",
      properties: {
        ["__proto__"]: { $ref: "https://example.test/number", type: "number", maximum: 3 },
      },
      required: ["__proto__"],
      additionalProperties: false,
    };
    const options = {
      declaration: { ...declaration, inputSchema, resultSchema: inputSchema },
      entry,
      entryMode: "explicit" as const,
      schemaDocuments: [
        { $id: "https://example.test/number", type: "number", allOf: [{ minimum: 1 }] },
      ],
      outDirectory: join(directory, "shared"),
    };
    const analyzed = await compileTaskBundle(options);
    assertRuntimeOnly(analyzed.metafile);
    const built = await buildTaskBundle(options);
    for (const value of [1, 2, 3]) {
      const frames = await execute(built, { ["__proto__"]: value });
      assert.deepEqual(frames.find((frame) => frame.kind === "complete")?.value, {
        ["__proto__"]: value,
      });
    }
    for (const value of [0, 4, "bad"])
      assert.equal(
        (
          (await execute(built, { ["__proto__"]: value })).find((frame) => frame.kind === "failed")
            ?.value as { code: string } | undefined
        )?.code,
        "invalid_input",
      );
    await writeFile(
      entry,
      `import {runTask} from "@potential-guide/task-sdk";
import {compileJsonSchema} from "@potential-guide/task-protocol";
const authorValidator = compileJsonSchema({type: "string", minLength: 5});
runTask(async input => {authorValidator.validate(input.text); return input;});`,
    );
    const opted = await compileTaskBundle({
      declaration,
      entry,
      entryMode: "explicit",
      outDirectory: join(directory, "opt-in"),
    });
    assert.ok(
      Object.keys(opted.metafile.inputs).some((path) => /ajv[\\/]dist[\\/]core/.test(path)),
    );
    const optedBundle = await buildTaskBundle({
      declaration,
      entry,
      entryMode: "explicit",
      outDirectory: join(directory, "opt-in"),
    });
    assert.equal(
      (
        (await execute(optedBundle, { text: "ab" })).find((frame) => frame.kind === "failed")
          ?.value as { code: string } | undefined
      )?.code,
      "invalid_input",
    );
    assert.deepEqual(
      (await execute(optedBundle, { text: "hello" })).find((frame) => frame.kind === "complete")
        ?.value,
      { text: "hello" },
    );
  });
});

test("legacy named callback exports retain the lazy compatibility path", async () => {
  await fixture(async (directory) => {
    const entry = join(directory, "callback.ts");
    await writeFile(entry, "export async function chosen(input) { return input; }");
    const built = await buildTaskBundle({
      declaration,
      entry,
      exportName: "chosen",
      outDirectory: join(directory, "legacy"),
    });
    const frames = await execute(built, { text: "legacy" });
    assert.equal(frames.filter((frame) => frame.kind === "ready").length, 1);
    assert.deepEqual(frames.find((frame) => frame.kind === "complete")?.value, { text: "legacy" });
  });
});

test("the author's separately installed public SDK copy receives the same locked binding", async () => {
  await fixture(async (directory) => {
    const installed = join(directory, "node_modules", "@potential-guide", "task-sdk");
    await mkdir(installed, { recursive: true });
    await cp(new URL("../../task-sdk/dist/", import.meta.url), join(installed, "dist"), {
      recursive: true,
    });
    await cp(
      new URL("../../task-sdk/package.json", import.meta.url),
      join(installed, "package.json"),
    );
    await writeFile(join(directory, "package.json"), '{"private":true,"type":"module"}');
    const entry = join(directory, "main.ts");
    await writeFile(
      entry,
      'import {runTask} from "@potential-guide/task-sdk"; runTask(async input => input);',
    );
    const options = {
      declaration,
      entry,
      entryMode: "explicit" as const,
      outDirectory: join(directory, "bundle"),
    };
    assertRuntimeOnly((await compileTaskBundle(options)).metafile);
    const frames = await execute(await buildTaskBundle(options), { text: "installed" });
    assert.deepEqual(frames.find((frame) => frame.kind === "complete")?.value, {
      text: "installed",
    });
  });
});

for (const scenario of precompileCases)
  test(`Engine-validated Worker shared expected data: ${scenario.name}`, async () => {
    await fixture(async (directory) => {
      const wrapper = {
        type: "object",
        properties: { value: scenario.schema },
        required: ["value"],
        additionalProperties: false,
        ...(scenario.schema && typeof scenario.schema === "object" && "$defs" in scenario.schema
          ? { $defs: scenario.schema.$defs }
          : {}),
      };
      const entry = join(directory, "main.ts");
      for (const role of ["input", "result", "message"]) {
        await writeFile(
          entry,
          role === "message"
            ? 'import {runTask} from "@potential-guide/task-sdk"; runTask(async (_input, context) => { for await (const message of context.messages) return message.payload; });'
            : 'import {runTask} from "@potential-guide/task-sdk"; runTask(async input => input);',
        );
        const built = await buildTaskBundle({
          entry,
          entryMode: "explicit",
          outDirectory: join(directory, role),
          declaration: {
            ...declaration,
            inputSchema: role === "input" ? wrapper : { type: "object" },
            resultSchema: role === "result" ? wrapper : true,
            messageSchema: role === "message" ? scenario.schema : false,
          },
        });
        for (const value of scenario.good) {
          const frames = await execute(built, { value }, role === "message" ? value : undefined);
          assert.deepEqual(
            frames.find((frame) => frame.kind === "complete")?.value,
            role === "message" ? value : { value },
            `${role} valid`,
          );
        }
        for (const value of scenario.bad) {
          if (role === "message")
            await assert.rejects(execute(built, { value }, value), {
              message: "Input does not satisfy inputSchema.",
            });
          else {
            const frames = await execute(built, { value });
            assert.deepEqual(
              frames.find((frame) => frame.kind === "failed")?.value,
              { code: "invalid_input", message: "Input does not satisfy inputSchema." },
              `${role} invalid`,
            );
          }
        }
      }
    });
  });
