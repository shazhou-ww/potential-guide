import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { parseArtifactYaml, readArtifactFiles } from "@potential-guide/artifact-files";
import { checkTaskArtifact, readTaskArtifact } from "@potential-guide/pguide-task-bundle/artifact";
import { validateContentCar } from "../src/car.js";
import {
  compileInputSchema,
  compileJsonSchema,
  validateTaskBundle,
} from "@potential-guide/task-protocol";
import { Type } from "@sinclair/typebox";
import { buildTask, checkTaskBuild, taskBuildSchemaUri, toTaskSchema } from "../src/authoring.js";

const execute = promisify(execFile);
test("nested trusted contract modules resolve __dirname relative to the contract, not the build file", async () => {
  await fixture(async (root, file) => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "value.txt"), "nested");
    await writeFile(
      join(root, "src", "contract.ts"),
      `import {Type} from "@sinclair/typebox";
import {readFileSync} from "node:fs";
import {join} from "node:path";
const text=readFileSync(join(__dirname,"value.txt"),"utf8");
export default {input:Type.Object({text:Type.Literal(text)}),result:Type.String(),message:Type.Never()};`,
    );
    const definition = JSON.parse(await readFile(file, "utf8"));
    definition.source.contract = "src/contract.ts";
    await writeFile(file, JSON.stringify(definition));
    const checked = await checkTaskBuild(file);
    const compiled = compileInputSchema(checked.resolved.inputSchema);
    assert.deepEqual(compiled.validate({ text: "nested" }), { text: "nested" });
    assert.throws(() => compiled.validate({ text: "wrong" }));
    assert.equal((await readdir(root)).includes("dist"), false);
  });
});
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

test("artifact reads return an immutable checked snapshot when disk changes", async () => {
  await fixture(async (_root, file) => {
    const built = await buildTask(file);
    const snapshot = await readTaskArtifact(built.car);
    await writeFile(join(built.directory, "resources", "one.json"), '{"changed":true}');
    assert.equal(snapshot.cid, built.cid);
    assert.equal((await validateContentCar(snapshot.archive!)).cid, built.cid);
    assert.notEqual((await checkTaskArtifact(built.directory)).cid, built.cid);
  });
});
test("offline CAR validation rejects a different expected root without rewriting the artifact", async () => {
  await fixture(async (_root, file) => {
    const built = await buildTask(file);
    const before = await readArtifactFiles(built.directory);
    const { CID } = await import("multiformats/cid");
    const { sha256 } = await import("multiformats/hashes/sha2");
    const wrong = CID.createV1(0x55, await sha256.digest(Buffer.from("wrong")));
    await assert.rejects(
      validateContentCar(await readFile(built.car), wrong.toString()),
      /expected root/,
    );
    assert.deepEqual(await readArtifactFiles(built.directory), before);
  });
});

test("the final CAR is deterministic and independently checkable after all author and directory files are removed", async () => {
  await fixture(async (root, file) => {
    const built = await buildTask(file);
    const original = await readFile(built.car);
    assert.equal(built.car, `${built.directory}.car`);
    assert.equal((await checkTaskArtifact(built.car)).cid, built.cid);
    assert.equal((await buildTask(file)).cid, built.cid);
    assert.deepEqual(await readFile(built.car), original);
    await rm(built.directory, { recursive: true });
    for (const name of ["callback.ts", "contract.ts", "task.build.yaml", "assets"])
      await rm(join(root, name), { recursive: true });
    assert.equal((await checkTaskArtifact(built.car)).cid, built.cid);
    const snapshot = await readTaskArtifact(built.car);
    await writeFile(built.car, "changed on disk after CAR admission");
    assert.equal((await validateContentCar(snapshot.archive!)).cid, built.cid);
    await assert.rejects(readTaskArtifact(built.car));
  });
});

test("unmanaged or corrupt CAR siblings are never overwritten and failed rebuilds preserve prior output", async () => {
  await fixture(async (root, file) => {
    const car = join(root, "dist.car");
    await writeFile(car, "unmanaged bytes");
    await assert.rejects(buildTask(file), /unmanaged Task CAR/);
    assert.equal(await readFile(car, "utf8"), "unmanaged bytes");
    await rm(car);
    const built = await buildTask(file);
    const before = await readArtifactFiles(built.directory);
    await writeFile(car, "corrupt prior CAR");
    await assert.rejects(buildTask(file));
    assert.equal(await readFile(car, "utf8"), "corrupt prior CAR");
    assert.deepEqual(await readArtifactFiles(built.directory), before);
    assert.equal(
      (await readdir(root)).some((name) => /previous|\.lock$/.test(name)),
      false,
    );
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
  const root = resolve(".cache", `task-authoring-${randomUUID()}`);
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
  }
}
test("author check is write-free; build is deterministic, complete and clean; artifact checks need no sources", async () => {
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
    await writeFile(join(root, "assets", "new.json"), '{"new":true}\n');
    const added = await buildTask(file);
    assert.notEqual(added.cid, first.cid);
    assert.equal((await readArtifactFiles(added.directory)).has("resources/new.json"), true);
    await rm(join(root, "assets", "one.json"));
    const second = await buildTask(file);
    assert.notEqual(second.cid, first.cid);
    assert.equal((await readArtifactFiles(second.directory)).has("resources/one.json"), false);
    await writeFile(join(root, "contract.ts"), "throw new Error('must not evaluate');");
    await assert.rejects(buildTask(file), /must not evaluate/);
    assert.equal((await checkTaskArtifact(second.directory)).cid, second.cid);
    await rm(join(root, "callback.ts"));
    await rm(file);
    assert.equal((await checkTaskArtifact(second.directory)).cid, second.cid);
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
    await writeFile(join(built.directory, "resources", "extra.json"), "{}");
    await assert.rejects(checkTaskArtifact(built.directory), /undeclared/);
    await rm(join(built.directory, "resources", "extra.json"));
    await rm(join(built.directory, "resources", "one.json"));
    await assert.rejects(checkTaskArtifact(built.directory), /missing/);
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
    Object.assign(Type.Tuple([Type.String()]), { additionalItems: true }),
    Type.Transform(Type.String())
      .Decode((x) => x.length)
      .Encode((x) => String(x)),
  ])
    assert.throws(() => toTaskSchema(unsupported), /Unsupported|does not enforce/);
  assert.throws(() => compileInputSchema(toTaskSchema(Type.String())), /root type object/);
});
test("TypeBox JSON contracts preserve readonly, arrays, records, optional fields and local fragments", () => {
  const schema = toTaskSchema(
    Type.Object(
      {
        fixed: Type.Readonly(Type.String()),
        values: Type.Array(Type.Integer(), { minItems: 1 }),
        labels: Type.Record(Type.String(), Type.Boolean()),
        optional: Type.Optional(Type.String()),
        local: Type.Ref("#/$defs/text"),
      },
      { additionalProperties: false, $defs: { text: Type.String({ minLength: 2 }) } },
    ),
  );
  const compiled = compileInputSchema(schema);
  const valid = { fixed: "a", values: [1], labels: { present: true }, local: "ok" };
  assert.deepEqual(compiled.validate(valid), valid);
  for (const invalid of [
    { ...valid, fixed: 1 },
    { ...valid, values: [] },
    { ...valid, values: [1.5] },
    { ...valid, labels: { present: "yes" } },
    { ...valid, optional: 1 },
    { ...valid, local: "x" },
    { ...valid, extra: true },
  ])
    assert.throws(() => compiled.validate(invalid));
  assert.throws(() => compileJsonSchema(toTaskSchema(Type.Never())).validate(null));
});
test("identical authors in independent roots produce the same CID and Worker bytes", async () => {
  await fixture(async (_root, file) => {
    const first = await buildTask(file);
    await fixture(async (_other, otherFile) => {
      const second = await buildTask(otherFile);
      assert.equal(first.cid, second.cid);
      assert.deepEqual(
        await readFile(join(first.directory, "worker.cjs")),
        await readFile(join(second.directory, "worker.cjs")),
      );
    });
  });
});
test("build emits YAML and no persistent sidecar, and rebuilds a copied artifact", async () => {
  await fixture(async (root, file) => {
    const before = await readdir(root);
    const built = await buildTask(file);
    assert.deepEqual((await readdir(root)).sort(), [...before, "dist", "dist.car"].sort());
    const bytes = await readFile(join(built.directory, "task.yaml"));
    assert.match(bytes.toString(), /^\$schema: /);
    assert.throws(() => JSON.parse(bytes.toString()));
    assert.deepEqual(parseArtifactYaml(bytes), built.declaration);
    for (const [index, name] of (
      ["inputSchema", "resultSchema", "messageSchema"] as const
    ).entries()) {
      assert.deepEqual(built.declaration[name], { $ref: `schemas/${index}.json` });
      assert.ok(built.declaration.include.includes(`schemas/${index}.json`));
    }
    assert.equal((await buildTask(file)).cid, built.cid);
    await fixture(async (other, otherFile) => {
      const copied = join(other, "dist");
      await cp(built.directory, copied, { recursive: true });
      assert.equal((await buildTask(otherFile)).cid, built.cid);
    });
    await writeFile(join(built.directory, "unknown.txt"), "preserve");
    await assert.rejects(buildTask(file), /extra|undeclared|unexpected/i);
    assert.equal(await readFile(join(built.directory, "unknown.txt"), "utf8"), "preserve");
  });
});
test("existing locks and changed ownership preserve the complete prior output and recovery files", async () => {
  await fixture(async (root, file) => {
    const built = await buildTask(file);
    const marker = `${built.directory}.pguide-task-bundle.json`;
    const lock = `${marker}.lock`;
    const ownership = `${JSON.stringify({ version: 1, output: built.directory, owner: file })}\n`;
    await writeFile(lock, "another build or interrupted process");
    await assert.rejects(buildTask(file), /locked.*crashed/);
    assert.equal(await readFile(lock, "utf8"), "another build or interrupted process");
    assert.equal((await checkTaskArtifact(built.directory)).cid, built.cid);
    await rm(lock);
    await writeFile(marker, "{}");
    await assert.rejects(buildTask(file), /ownership/);
    assert.equal((await checkTaskArtifact(built.directory)).cid, built.cid);
    assert.equal(await readFile(marker, "utf8"), "{}");
    assert.equal((await readdir(root)).includes("dist.pguide-task-bundle.json.lock"), false);
    await writeFile(marker, ownership);
    assert.equal((await buildTask(file)).cid, built.cid);
    await assert.rejects(readFile(marker), { code: "ENOENT" });
  });
});
test("removed publishing CLI and library entrypoints cannot upload or pin", async () => {
  await fixture(async (root, file) => {
    const built = await buildTask(file);
    const before = await readArtifactFiles(built.directory);
    await writeFile(join(root, "contract.ts"), "throw new Error('must not evaluate');");
    const bin = resolve("dist", "bin.js");
    await assert.rejects(
      execute(process.execPath, [bin, "publish", built.car, "--ipfs-rpc", "http://127.0.0.1:1"]),
    );
    const removed = "@potential-guide/pguide-task-bundle/publish";
    await assert.rejects(import(removed), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
    assert.equal((await checkTaskArtifact(built.car)).cid, built.cid);
    assert.deepEqual(await readArtifactFiles(built.directory), before);
  });
});
test("unsafe output, unmanaged output, empty and overlapping globs fail without altering existing files", async () => {
  await fixture(async (root, file) => {
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist", "user.txt"), "keep");
    await assert.rejects(buildTask(file));
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
  const buildApi = await import("@potential-guide/pguide-task-bundle/build");
  assert.equal("createIpfsClient" in buildApi, false);
  assert.equal("importTaskBundle" in buildApi, false);
  const bin = resolve("dist", "bin.js");
  const metadata = JSON.parse(
    (await execute(process.execPath, [bin, "--pguide-command-metadata"])).stdout,
  );
  assert.equal(metadata.protocol, "pguide-command-v1");
  assert.equal(metadata.command, "task-bundle");
  const help = JSON.parse(
    (await execute(process.execPath, [bin, "--help", "--format", "json"])).stdout,
  );
  assert.deepEqual(help.subcommands, ["init", "check", "build"]);
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
