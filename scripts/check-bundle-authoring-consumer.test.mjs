import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { checkBundleAuthoringConsumer } from "./check-bundle-authoring-consumer.mjs";

test("Bundle runtime rejects a repository-local override before touching author inputs", async () => {
  const previous = process.env.PGUIDE_PACK_CONSUMER_ROOT;
  const directory = resolve(".cache", `rejected-bundle-isolation-${randomUUID()}`);
  try {
    process.env.PGUIDE_PACK_CONSUMER_ROOT = resolve(".");
    await assert.rejects(
      checkBundleAuthoringConsumer(directory, "fixture", new Map(), new Map(), () =>
        assert.fail("Must not publish"),
      ),
      /outside the repository/,
    );
    await assert.rejects(access(directory), { code: "ENOENT" });
  } finally {
    if (previous === undefined) delete process.env.PGUIDE_PACK_CONSUMER_ROOT;
    else process.env.PGUIDE_PACK_CONSUMER_ROOT = previous;
  }
});

for (const fails of [false, true])
  test(`Bundle runtime isolation escapes author dependencies and cleans up on ${fails ? "failure" : "success"}`, async () => {
    const directory = resolve(".cache", `bundle-isolation-${randomUUID()}`);
    const authorDependencies = [
      "@sinclair/typebox",
      "@potential-guide/task-sdk",
      "@potential-guide/pguide-task-bundle",
      "@potential-guide/ipfs-content",
    ];
    const dependency = join(directory, "node_modules", "@sinclair", "typebox");
    const engine = "@potential-guide/task-engine";
    const manifest = { name: engine, version: "0.1.0", dependencies: {} };
    const failure = new Error("Intentional runtime consumption failure.");
    let runtime;
    await mkdir(dependency, { recursive: true });
    try {
      for (const name of authorDependencies) {
        const path = join(directory, "node_modules", ...name.split("/"));
        await mkdir(path, { recursive: true });
        await writeFile(join(path, "package.json"), '{"main":"index.js"}');
        await writeFile(join(path, "index.js"), "module.exports={};");
        assert.equal(
          createRequire(join(directory, "probe.cjs")).resolve(name),
          join(path, "index.js"),
        );
      }
      for (const file of ["main.ts", "contract.ts", "task.build.yaml"])
        await writeFile(join(directory, file), "");
      assert.equal(
        createRequire(join(directory, "probe.cjs")).resolve("@sinclair/typebox"),
        join(dependency, "index.js"),
      );
      const run = async (_command, args, cwd) => {
        if (args[0] === "publish.mjs") {
          await writeFile(join(cwd, "blocks.json"), "[]");
        } else if (args[0] === "install") {
          runtime = cwd;
          const location = relative(resolve("."), runtime);
          assert.ok(
            isAbsolute(location) || location === ".." || location.startsWith(`..${sep}`),
            "Runtime must be outside the repository dependency ancestry.",
          );
          for (const name of authorDependencies)
            assert.throws(() => createRequire(join(runtime, "probe.cjs")).resolve(name), {
              code: "MODULE_NOT_FOUND",
            });
          const packageDirectory = join(runtime, "node_modules", ...engine.split("/"));
          await mkdir(packageDirectory, { recursive: true });
          await writeFile(join(packageDirectory, "package.json"), JSON.stringify(manifest));
        } else {
          assert.equal(args[0], "consume.mjs");
          assert.equal(await readFile(join(cwd, "blocks.json"), "utf8"), "[]");
          const source = await readFile(join(cwd, "consume.mjs"), "utf8");
          assert.match(source, /assert\.rejects\(import\(name\)/);
          if (fails) throw failure;
        }
        return "isolated consumption";
      };
      const check = () =>
        checkBundleAuthoringConsumer(
          directory,
          "fixture-cid",
          new Map([[engine, join(directory, "engine.tgz")]]),
          new Map([[engine, manifest]]),
          run,
        );
      if (fails) await assert.rejects(check(), (error) => error === failure);
      else await check();
      assert.ok(runtime);
      await assert.rejects(access(runtime), { code: "ENOENT" });
      await access(dependency);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
