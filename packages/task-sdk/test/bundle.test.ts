import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { parseArtifactYaml, readArtifactFiles } from "@potential-guide/check-artifacts/files";
import { MemoryIpfsClient } from "@potential-guide/ipfs-content/testing";
import {
  compileInputSchema,
  resolveBundleSchemas,
  taskSchemaUri,
  validateTaskBundle,
} from "@potential-guide/task-protocol";
import { buildTaskBundle } from "../src/build.js";
import { importTaskBundle } from "../src/publish.js";

const declaration = {
  $schema: taskSchemaUri,
  name: "相同展示名称",
  runtime: { type: "node", minVersion: "22.13.0" },
  entry: "worker.cjs",
  include: ["task.yaml", "worker.cjs"],
  inputSchema: { $ref: "https://example.test/input" },
  resultSchema: { $ref: "https://example.test/result" },
  messageSchema: false,
};
async function workspace(run: (directory: string) => Promise<void>) {
  const directory = resolve(".test-task-sdk", randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rmdir(resolve(".test-task-sdk")).catch(() => {});
  }
}
test("V01: generated production Worker runs after author sources are removed, with locked transitive Schemas", async () => {
  await workspace(async (directory) => {
    const author = join(directory, "author");
    await mkdir(author);
    const shared = [
      {
        $id: "https://example.test/input",
        type: "object",
        properties: { text: { $ref: "./text#value" } },
        required: ["text"],
        additionalProperties: true,
      },
      {
        $id: "https://example.test/result",
        type: "object",
        properties: { text: { $ref: "./text#value" } },
        required: ["text"],
        additionalProperties: false,
      },
      { $id: "https://example.test/text", $defs: { value: { $anchor: "value", type: "string" } } },
    ];
    const schemas: { path: string; digest: string }[] = [];
    for (const [index, schema] of shared.entries()) {
      const path = join(author, `${index}.json`);
      const bytes = Buffer.from(JSON.stringify(schema));
      await writeFile(path, bytes);
      schemas.push({ path, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` });
    }
    const yaml = join(author, "task.yaml");
    await writeFile(yaml, JSON.stringify(declaration));
    const callback = join(author, "callback.ts");
    const evaluated = join(directory, "callback-evaluated.txt");
    await writeFile(
      callback,
      `import {canonical} from "@potential-guide/task-protocol";
import {appendFileSync} from "node:fs";
appendFileSync(${JSON.stringify(evaluated)},"evaluated\\n");
export default async (input, context) => {
  await context.progress({stage:"execution",message:canonical(input)});
  return {text: input.text};
};`,
    );
    const built = await buildTaskBundle({
      declaration: yaml,
      entry: callback,
      schemas,
      outDirectory: join(directory, "bundle"),
    });
    const published = await importTaskBundle(built.directory, new MemoryIpfsClient());
    assert.equal(published.cid, built.cid);
    const files = await readArtifactFiles(built.directory);
    assert.equal([...files.keys()].filter((name) => name.startsWith("schemas/")).length, 3);
    const resolved = resolveBundleSchemas(
      validateTaskBundle(parseArtifactYaml(files.get("task.yaml")!)),
      shared,
    );
    const contract = compileInputSchema(resolved.inputSchema);
    contract.validate({ text: "hello", extra: 1 });
    assert.equal(contract.equals({ text: "hello", extra: 1 }, { text: "hello", extra: 2 }), false);
    await rm(author, { recursive: true });
    assert.equal(
      [...(await readArtifactFiles(built.directory))].some(([path]) =>
        path.includes("node_modules"),
      ),
      false,
    );
    const generation = randomUUID();
    const worker = new Worker(join(built.directory, "worker.cjs"), {
      execArgv: [],
      env: { NODE_OPTIONS: "" },
      workerData: {
        generation,
        maxInFlight: 8,
        maxPayloadBytes: 65_536,
        bundle: { cid: built.cid, declaration: resolved },
      },
    });
    let completed = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Worker timed out.")), 10_000);
        worker.once("error", reject);
        worker.on("message", (message) => {
          try {
            assert.equal(message.generation, generation);
            if (message.kind === "ready") {
              assert.equal(
                existsSync(evaluated),
                false,
                "Business module must not execute before the Run command.",
              );
              assert.equal(message.value.$schema, taskSchemaUri);
              worker.postMessage({
                generation,
                kind: "run",
                runId: "run",
                scope: "scope",
                input: { text: "hello" },
              });
            } else if (message.id !== undefined) {
              if (message.kind === "complete") {
                assert.deepEqual(message.value, { text: "hello" });
                completed = true;
              }
              assert.notEqual(message.kind, "failed");
              worker.postMessage({ generation, kind: "ack", id: message.id });
            } else if (message.kind === "released") {
              assert.equal(completed, true);
              clearTimeout(timer);
              resolve();
            } else if (message.kind === "uncertain")
              reject(new Error("Worker cleanup was uncertain."));
          } catch (error) {
            clearTimeout(timer);
            reject(error);
          }
        });
      });
    } finally {
      await worker.terminate();
    }
    assert.equal(await readFile(evaluated, "utf8"), "evaluated\n");
  });
});
test("V01: build fails on changed Schema locks, incomplete closure, conflicts and unresolved fragments", async () => {
  await workspace(async (directory) => {
    const yaml = join(directory, "task.yaml");
    const callback = join(directory, "callback.ts");
    const path = join(directory, "schema.json");
    await writeFile(yaml, JSON.stringify(declaration));
    await writeFile(callback, "export default async input => input;");
    await writeFile(path, "{}");
    await assert.rejects(
      buildTaskBundle({
        declaration: yaml,
        entry: callback,
        outDirectory: join(directory, "bad"),
        schemas: [{ path, digest: `sha256:${"0".repeat(64)}` }],
      }),
      /lock mismatch/,
    );
    await assert.rejects(
      buildTaskBundle({
        declaration: yaml,
        entry: callback,
        outDirectory: join(directory, "missing"),
      }),
      /Missing offline/,
    );
    const valid = validateTaskBundle({ ...declaration, resultSchema: false });
    const root = { $id: "https://example.test/input", type: "object" };
    assert.throws(
      () => resolveBundleSchemas(valid, [root, { ...root, title: "conflict" }]),
      /Conflicting/,
    );
    assert.throws(
      () =>
        resolveBundleSchemas(
          { ...valid, inputSchema: { $ref: "https://example.test/input#/missing" } },
          [root],
        ),
      /Missing Schema JSON Pointer/,
    );
    assert.throws(() => resolveBundleSchemas(valid, [{ type: "object" }]), /absolute/);
    assert.throws(
      () => validateTaskBundle({ ...declaration, protocolVersion: 1 }),
      /Invalid task.yaml/,
    );
    assert.throws(
      () =>
        validateTaskBundle(
          Object.fromEntries(
            Object.entries(declaration).filter(([key]) => key !== "messageSchema"),
          ),
        ),
      /Invalid task.yaml/,
    );
    for (const name of ["", " leading", "trailing ", "a\nb", "a\tb"])
      assert.throws(() => validateTaskBundle({ ...declaration, name }), /Invalid task.yaml/);
  });
});
test("removed Task v2 and future schemas cannot build or import Workers", async () => {
  await workspace(async (directory) => {
    const yaml = join(directory, "task.yaml");
    const callback = join(directory, "callback.ts");
    await writeFile(callback, "export default async input => input;");
    const bundle = join(directory, "bundle");
    await mkdir(bundle);
    await writeFile(join(bundle, "worker.cjs"), "throw Error('must not run');");
    for (const version of ["v2", "v3"]) {
      const manifest = JSON.stringify({
        ...declaration,
        $schema: taskSchemaUri.replace("v1", version),
        inputSchema: { type: "object" },
        resultSchema: true,
      });
      await writeFile(yaml, manifest);
      await writeFile(join(bundle, "task.yaml"), manifest);
      await assert.rejects(
        buildTaskBundle({
          declaration: yaml,
          entry: callback,
          outDirectory: join(directory, version),
        }),
        { code: "invalid_bundle" },
      );
      await assert.rejects(importTaskBundle(bundle, new MemoryIpfsClient()), {
        code: "invalid_bundle",
      });
      assert.equal(existsSync(join(directory, version)), false);
    }
  });
});
test("V01: unsupported dynamic imports and native extensions cannot become self-contained Workers", async () => {
  await workspace(async (directory) => {
    const yaml = join(directory, "task.yaml");
    const callback = join(directory, "callback.ts");
    await writeFile(
      yaml,
      JSON.stringify({ ...declaration, inputSchema: { type: "object" }, resultSchema: true }),
    );
    for (const code of [
      "export default async input => import(input.path);",
      "export default async input => require(input.path);",
      "export default async input => import.meta.resolve(input.path);",
      "import native from './binding.node'; export default async () => native;",
    ]) {
      await writeFile(callback, code);
      await assert.rejects(
        buildTaskBundle({
          declaration: yaml,
          entry: callback,
          outDirectory: join(directory, randomUUID()),
        }),
      );
    }
  });
});
