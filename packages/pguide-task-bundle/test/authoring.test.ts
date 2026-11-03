import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { readArtifactFiles } from "@potential-guide/check-artifacts/files";
import { MemoryIpfsClient } from "@potential-guide/ipfs-content/testing";
import {
  compileInputSchema,
  compileJsonSchema,
  validateTaskBundle,
} from "@potential-guide/task-protocol";
import { checkTaskArtifact } from "@potential-guide/task-sdk/artifact";
import { importTaskBundle } from "@potential-guide/task-sdk/publish";
import { Type } from "@sinclair/typebox";
import { buildTask, checkTaskBuild, taskBuildSchemaUri, toTaskSchema } from "../src/authoring.js";

const execute = promisify(execFile);
test("shared TypeBox resources resolve offline and fail on missing closure or conflicting IDs", async () => {
  await fixture(async (root, file) => {
    await writeFile(
      join(root, "contract.ts"),
      `import { Type } from "@sinclair/typebox";
const text=Type.String({$id:"https://example.test/text"});
export default {input:Type.Object({text:Type.Ref(text)}),result:Type.Ref(text),message:Type.Never(),schemas:[text]};`,
    );
    const checked = await checkTaskBuild(file);
    compileInputSchema(checked.resolved.inputSchema).validate({ text: "reference" });
    assert.equal(checked.files.filter((name) => name.startsWith("schemas/")).length, 4);
    for (const schemas of ["[]", `[text,Type.Number({$id:"https://example.test/text"})]`]) {
      await writeFile(
        join(root, "contract.ts"),
        `import {Type} from "@sinclair/typebox";
const text=Type.String({$id:"https://example.test/text"});
export default {input:Type.Object({text:Type.Ref(text)}),result:Type.String(),message:Type.Never(),schemas:${schemas}};`,
      );
      await assert.rejects(checkTaskBuild(file), /Missing offline|Conflicting/);
    }
    await writeFile(
      join(root, "contract.ts"),
      `import {Type} from "@sinclair/typebox";
export default {input:Type.Object({text:Type.String({unsupportedConstraint:true})}),result:Type.String(),message:Type.Never()};`,
    );
    await assert.rejects(checkTaskBuild(file), /Invalid JSON Schema|unknown keyword|Unsupported/i);
  });
});

test("publishing imports one checked snapshot even if disk changes during block upload", async () => {
  await fixture(async (_root, file) => {
    const built = await buildTask(file);
    const client = new MemoryIpfsClient();
    const put = client.block.put;
    let changed = false;
    client.block.put = async (bytes, options) => {
      if (!changed) {
        changed = true;
        await writeFile(join(built.directory, "resources", "one.json"), '{"changed":true}');
      }
      return put(bytes, options);
    };
    assert.equal((await importTaskBundle(built.directory, client)).cid, built.cid);
    assert.notEqual((await checkTaskArtifact(built.directory)).cid, built.cid);
    assert.ok(client.pins.has(built.cid));
  });
});

test("directory links cannot enter selected resources or redirect output writes", async () => {
  await fixture(async (root, file) => {
    const destination = join(root, "owned-target");
    await mkdir(destination);
    const link = join(root, "assets", "link");
    await symlink(destination, link, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(checkTaskBuild(file), /links/);
    await rm(link);
    await symlink(
      destination,
      join(root, "redirect"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const definition = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...definition, outDirectory: "redirect/nested/dist" }));
    await assert.rejects(buildTask(file), /links/);
    assert.deepEqual(await readdir(destination), []);
  });
});
const contract = `import { Type } from "@sinclair/typebox";
export default {
 input: Type.Object({text: Type.String(), tag: Type.Optional(Type.Union([Type.String(),Type.Number()]))}),
 result: Type.Object({text:Type.String()}),
 message: Type.Never()
};`;
async function fixture(action: (root: string, file: string) => Promise<void>) {
  const root = resolve(".test-task-authoring", randomUUID());
  await mkdir(join(root, "assets", "nested"), { recursive: true });
  try {
    await writeFile(join(root, "contract.ts"), contract);
    await writeFile(
      join(root, "callback.ts"),
      "export default async input => ({text:input.text});",
    );
    await writeFile(join(root, "assets", "one.json"), '{"one":1}\n');
    await writeFile(join(root, "assets", "nested", "two.json"), '{"two":2}\n');
    await writeFile(join(root, "assets", ".hidden.json"), "hidden");
    const file = join(root, "task.build.yaml");
    await writeFile(
      file,
      JSON.stringify({
        $schema: taskBuildSchemaUri,
        name: "typed example",
        runtime: { minVersion: "22.13.0" },
        source: { entry: "callback.ts", contract: "contract.ts" },
        include: [{ from: "assets/**/*.json", to: "resources/" }],
        outDirectory: "dist",
      }),
    );
    await action(root, file);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rmdir(resolve(".test-task-authoring")).catch(() => {});
  }
}
test("author check is write-free; build is deterministic, complete and clean; artifact-only publish needs no sources", async () => {
  await fixture(async (root, file) => {
    const before = await readdir(root);
    const checked = await checkTaskBuild(file);
    assert.deepEqual(await readdir(root), before);
    const first = await buildTask(file);
    assert.equal(first.cid, checked.cid);
    assert.equal((await buildTask(file)).cid, first.cid);
    const files = await readArtifactFiles(first.directory);
    assert.deepEqual([...files.keys()].sort(), first.declaration.include);
    assert.equal(files.has("resources/one.json"), true);
    assert.equal(files.has("resources/nested/two.json"), true);
    assert.equal(
      [...files.keys()].some((path) => path.includes(".hidden")),
      false,
    );
    const inspected = await checkTaskArtifact(first.directory);
    const input = compileInputSchema(inspected.resolved.inputSchema);
    assert.deepEqual(input.validate({ text: "hello", extra: 1 }), { text: "hello", extra: 1 });
    assert.equal(input.equals({ text: "hello", extra: 1 }, { text: "hello", extra: 2 }), false);
    assert.throws(() => input.validate({ text: 42 }));
    await rm(join(root, "assets", "one.json"));
    const second = await buildTask(file);
    assert.notEqual(second.cid, first.cid);
    assert.equal((await readArtifactFiles(second.directory)).has("resources/one.json"), false);
    await writeFile(join(root, "contract.ts"), "throw new Error('must not evaluate');");
    await assert.rejects(buildTask(file), /must not evaluate/);
    assert.equal((await checkTaskArtifact(second.directory)).cid, second.cid);
    await rm(join(root, "callback.ts"));
    await rm(file);
    const client = new MemoryIpfsClient();
    assert.equal((await importTaskBundle(second.directory, client)).cid, second.cid);
    assert.ok(client.pins.has(second.cid));
    const resolved = (await checkTaskArtifact(second.directory)).resolved;
    const generation = randomUUID();
    const worker = new Worker(join(second.directory, "worker.cjs"), {
      execArgv: [],
      env: { NODE_OPTIONS: "" },
      workerData: {
        generation,
        maxInFlight: 8,
        maxPayloadBytes: 65536,
        bundle: { cid: second.cid, declaration: resolved },
      },
    });
    try {
      await new Promise<void>((done, reject) => {
        const timer = setTimeout(() => reject(new Error("Worker timed out")), 10000);
        worker.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        worker.on("message", (message) => {
          if (message.kind === "ready")
            worker.postMessage({
              generation,
              kind: "run",
              runId: "run",
              scope: "test",
              input: { text: "works", extra: 3 },
            });
          if (message.id !== undefined)
            worker.postMessage({ generation, kind: "ack", id: message.id });
          if (message.kind === "complete") {
            try {
              assert.deepEqual(message.value, { text: "works" });
              clearTimeout(timer);
              done();
            } catch (error) {
              clearTimeout(timer);
              reject(error);
            }
          }
          if (message.kind === "failed") {
            clearTimeout(timer);
            reject(new Error(JSON.stringify(message)));
          }
        });
      });
    } finally {
      await worker.terminate();
    }
  });
});
test("strict manifest rejects old bundles, missing/extra files, glob paths and collisions", async () => {
  await fixture(async (root, file) => {
    const built = await buildTask(file);
    const client = new MemoryIpfsClient();
    await writeFile(join(built.directory, "resources", "extra.json"), "{}");
    await assert.rejects(importTaskBundle(built.directory, client), /undeclared/);
    assert.equal(client.blocks.size, 0);
    await rm(join(built.directory, "resources", "extra.json"));
    await rm(join(built.directory, "resources", "one.json"));
    await assert.rejects(importTaskBundle(built.directory, client), /missing/);
    const declaration = { ...built.declaration } as Record<string, unknown>;
    delete declaration.include;
    assert.throws(() => validateTaskBundle(declaration), /Rebuild.*new CID/);
    for (const include of [
      ["task.yaml", "worker.cjs", "resources/*.json"],
      ["task.yaml", "worker.cjs", "resources/a", "resources/A"],
      ["task.yaml", "worker.cjs", "resources/A/a", "resources/a/b"],
      ["task.yaml", "worker.cjs", "resources/a", "resources/a/b"],
    ])
      assert.throws(() => validateTaskBundle({ ...declaration, include }));
    assert.equal((await readdir(root)).includes("dist"), true);
  });
});
test("TypeBox conversion preserves optional, union, tuple and local reference semantics; unsupported behavior fails", () => {
  const schema = toTaskSchema(
    Type.Object({
      tuple: Type.Tuple([Type.String(), Type.Number()]),
      choice: Type.Union([Type.Literal("a"), Type.Literal("b")]),
    }),
  );
  const tuple = compileJsonSchema(toTaskSchema(Type.Tuple([Type.String(), Type.Number()])));
  assert.deepEqual(tuple.validate(["a", 2]), ["a", 2]);
  assert.throws(() => tuple.validate(["a"]));
  assert.throws(() => tuple.validate(["a", 2, 3]));
  assert.ok(schema);
  compileJsonSchema(toTaskSchema(Type.Never()));
  for (const unsupported of [
    Type.Date(),
    Type.Function([], Type.String()),
    Type.Unsafe({ type: "string" }),
    Type.String({ format: "email" }),
    Type.Transform(Type.String())
      .Decode((x) => x.length)
      .Encode((x) => String(x)),
  ])
    assert.throws(() => toTaskSchema(unsupported), /Unsupported|does not enforce/);
  assert.throws(() => compileInputSchema(toTaskSchema(Type.String())), /root type object/);
});
test("unsafe output, unmanaged output, empty and overlapping globs fail without altering existing files", async () => {
  await fixture(async (root, file) => {
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist", "user.txt"), "keep");
    await assert.rejects(buildTask(file), /unmanaged/);
    assert.equal(await readFile(join(root, "dist", "user.txt"), "utf8"), "keep");
    await rm(join(root, "dist"), { recursive: true });
    const definition = JSON.parse(await readFile(file, "utf8"));
    for (const change of [
      { outDirectory: "." },
      { outDirectory: "../other" },
      { include: [{ from: "assets/*.txt", to: "resources/" }] },
      {
        include: [
          { from: "assets/**/*.json", to: "resources/" },
          { from: "assets/*.json", to: "resources/" },
        ],
      },
      { include: [{ from: "**/*.json", to: "resources/" }] },
    ]) {
      await writeFile(file, JSON.stringify({ ...definition, ...change }));
      await assert.rejects(buildTask(file));
      assert.equal((await readdir(root)).includes("dist"), false);
    }
  });
});
test("CLI exposes pguide metadata, structured help and explicit check modes", async () => {
  const bin = resolve("dist", "bin.js");
  const metadata = JSON.parse(
    (await execute(process.execPath, [bin, "--pguide-command-metadata"])).stdout,
  );
  assert.equal(metadata.protocol, "pguide-command-v1");
  assert.equal(metadata.command, "task-bundle");
  const help = JSON.parse(
    (await execute(process.execPath, [bin, "--help", "--format", "json"])).stdout,
  );
  assert.deepEqual(help.subcommands, ["check", "build", "publish"]);
  await fixture(async (root, file) => {
    const checked = JSON.parse(
      (await execute(process.execPath, [bin, "check", "author", file, "--format", "json"])).stdout,
    );
    assert.equal(checked.status, "ok");
    assert.equal((await readdir(root)).includes("dist"), false);
    await assert.rejects(execute(process.execPath, [bin, "check", file, "--format", "json"]));
    await assert.rejects(execute(process.execPath, [bin, "include", file, "--format", "json"]));
  });
});
