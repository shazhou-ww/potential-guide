import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { on } from "node:events";
import { link, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { checkTaskArtifact } from "@potential-guide/pguide-task-bundle/artifact";
import { buildTask, checkTaskBuild } from "../src/authoring.js";
import { initTaskBundle } from "../src/init.js";
import { fileSymlink } from "./file-symlink.js";

const execute = promisify(execFile);
const typebox = "@sinclair/typebox";
const sdk = "@potential-guide/task-sdk";
async function fixture(action: (root: string) => Promise<void>) {
  const root = resolve(".cache", "task-init", randomUUID());
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), '{"private":true}\n');
  try {
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function readJson(file: string) {
  return JSON.parse(await readFile(file, "utf8"));
}
test("init creates a standalone minimal package that builds deterministically and runs", async () => {
  await fixture(async (root) => {
    const target = root;
    await writeFile(
      join(target, "package.json"),
      JSON.stringify({
        name: "task-bundle",
        private: true,
        type: "module",
        engines: { node: ">=22.13.0" },
      }),
    );
    const initialized = await initTaskBundle(target);
    assert.equal(initialized.directory, target);
    assert.equal(initialized.buildFile, join(target, "task.build.yaml"));
    assert.equal(initialized.packageDirectory, target);
    assert.equal(initialized.packageFile, join(target, "package.json"));
    assert.equal(initialized.packageCreated, false);
    assert.equal(initialized.dependencyAdded, true);
    assert.equal(initialized.buildScriptAdded, true);
    assert.equal(initialized.cleanScriptAdded, true);
    assert.equal(initialized.files.length, 5);
    assert.ok(initialized.files.includes(join(target, ".gitignore")));
    assert.equal(
      await readFile(join(target, ".gitignore"), "utf8"),
      "node_modules/\ndist/\ndist.car\n",
    );
    assert.deepEqual((await readdir(target)).sort(), [
      ".gitignore",
      "package.json",
      "src",
      "task.build.yaml",
    ]);
    assert.deepEqual(await readJson(initialized.packageFile), {
      name: "task-bundle",
      private: true,
      type: "module",
      engines: { node: ">=22.13.0" },
      dependencies: { [typebox]: "0.34.52", [sdk]: "0.1.0-rc.2" },
      scripts: {
        build: "pguide task-bundle build task.build.yaml",
        clean: `node -e "for (const path of ['dist', 'dist.car']) require('node:fs').rmSync(path, { recursive: true, force: true })"`,
      },
    });
    await mkdir(join(target, "node_modules", "@sinclair"), { recursive: true });
    await symlink(
      await realpath(resolve("node_modules", "@sinclair", "typebox")),
      join(target, "node_modules", "@sinclair", "typebox"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await mkdir(join(target, "node_modules", "@potential-guide"), { recursive: true });
    await symlink(
      await realpath(resolve("node_modules", "@potential-guide", "task-sdk")),
      join(target, "node_modules", "@potential-guide", "task-sdk"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const main = await readFile(join(target, "src", "main.ts"), "utf8");
    assert.match(main, /import \{ runTask \} from "@potential-guide\/task-sdk"/);
    assert.match(main, /import type contract/);
    assert.match(main, /runTask\(async function echo/);
    await execute(
      process.execPath,
      [
        resolve("..", "..", "node_modules", "typescript", "bin", "tsc"),
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "NodeNext",
        "--target",
        "ES2023",
        "src/main.ts",
      ],
      { cwd: target },
    );
    const checked = await checkTaskBuild(initialized.buildFile);
    const built = await buildTask(initialized.buildFile);
    assert.equal(built.cid, checked.cid);
    assert.equal((await buildTask(initialized.buildFile)).cid, built.cid);
    const artifact = await checkTaskArtifact(built.directory);
    assert.equal(artifact.cid, built.cid);
    const generation = randomUUID();
    const worker = new Worker(join(built.directory, "worker.cjs"), {
      execArgv: [],
      env: { NODE_OPTIONS: "" },
      workerData: {
        generation,
        maxInFlight: 8,
        maxPayloadBytes: 65536,
        bundle: { cid: built.cid, declaration: artifact.resolved },
      },
    });
    try {
      for await (const [message] of on(worker, "message", { signal: AbortSignal.timeout(10000) })) {
        if (message.kind === "ready")
          worker.postMessage({
            generation,
            kind: "run",
            runId: "init-test",
            scope: "test",
            input: { text: "minimal task works" },
          });
        if (message.id !== undefined)
          worker.postMessage({ generation, kind: "ack", id: message.id });
        if (message.kind === "failed") assert.fail(JSON.stringify(message));
        if (message.kind === "complete") {
          assert.deepEqual(message.value, { text: "minimal task works" });
          break;
        }
      }
    } finally {
      await worker.terminate();
    }
  });
});
test("generated gitignore excludes dependencies and build output but keeps task sources trackable", async () => {
  await fixture(async (root) => {
    await initTaskBundle(root);
    await execute("git", ["init", "--quiet", root]);
    await mkdir(join(root, "node_modules"));
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "node_modules", "dependency.js"), "");
    await writeFile(join(root, "dist", "task.yaml"), "");
    const ignored = await execute("git", [
      "-C",
      root,
      "check-ignore",
      "--no-index",
      "node_modules/dependency.js",
      "dist/task.yaml",
      "src/main.ts",
      "src/contract.ts",
      "task.build.yaml",
      "package.json",
      ".gitignore",
    ]);
    assert.deepEqual(ignored.stdout.trim().split(/\r?\n/), [
      "node_modules/dependency.js",
      "dist/task.yaml",
    ]);
  });
});
test("init preserves an existing gitignore byte for byte and excludes it from written files", async () => {
  await fixture(async (root) => {
    const ignoreFile = join(root, ".gitignore");
    const source = "# custom\r\n!dist/keep.json\r\nsecret.env\r\n";
    await writeFile(ignoreFile, source);
    const result = await initTaskBundle(root);
    assert.equal(await readFile(ignoreFile, "utf8"), source);
    assert.ok(!result.files.includes(ignoreFile));
    assert.equal(result.files.length, 4);
  });
});
test("init rejects directory, linked and hardlinked gitignore paths before writing templates", async (t) => {
  for (const kind of ["directory", "link", "broken-link", "hardlink"])
    await t.test(kind, async (context) => {
      await fixture(async (root) => {
        const target = join(root, "task");
        await mkdir(target);
        const original = join(root, "custom-ignore");
        await writeFile(original, "keep\n");
        const ignoreFile = join(target, ".gitignore");
        if (kind === "directory") await mkdir(ignoreFile);
        else if (kind === "hardlink") await link(original, ignoreFile);
        else if (
          !(await fileSymlink(
            context,
            kind === "broken-link" ? join(root, "missing") : original,
            ignoreFile,
          ))
        )
          return;
        await assert.rejects(initTaskBundle(target), /gitignore must be a regular, unlinked file/);
        assert.deepEqual(await readdir(target), [".gitignore"]);
        assert.equal(await readFile(original, "utf8"), "keep\n");
      });
    });
});
test("init reuses the nearest ancestor package and preserves unrelated fields and files", async () => {
  await fixture(async (root) => {
    const outer = join(root, "package.json");
    await writeFile(outer, '{"private":true}\n');
    const inner = join(root, "app");
    await mkdir(inner);
    const manifest = {
      name: "@example/app",
      type: "commonjs",
      scripts: { build: "custom-build", clean: "custom-clean" },
      packageManager: "pnpm@11.22.0",
      dependencies: { existing: "workspace:*" },
      custom: { keep: true },
    };
    const packageFile = join(inner, "package.json");
    await writeFile(packageFile, JSON.stringify(manifest));
    const target = join(inner, "tasks", "echo");
    await mkdir(join(target, "src"), { recursive: true });
    await writeFile(join(target, "src", "keep.ts"), "keep");
    const result = await initTaskBundle(target);
    assert.equal(result.packageFile, packageFile);
    assert.equal(result.packageCreated, false);
    assert.equal(result.dependencyAdded, true);
    assert.equal(result.buildScriptAdded, false);
    assert.equal(result.cleanScriptAdded, false);
    assert.deepEqual(await readJson(packageFile), {
      ...manifest,
      dependencies: { existing: "workspace:*", [typebox]: "0.34.52", [sdk]: "0.1.0-rc.2" },
    });
    assert.equal(await readFile(outer, "utf8"), '{"private":true}\n');
    assert.equal(await readFile(join(target, "src", "keep.ts"), "utf8"), "keep");
    assert.ok(!(await readdir(target)).includes("package.json"));
  });
});
test("init leaves ancestor scripts and manifest bytes unchanged when TypeBox is already declared", async () => {
  await fixture(async (root) => {
    const packageFile = join(root, "package.json");
    await writeFile(
      packageFile,
      JSON.stringify({
        private: true,
        devDependencies: { [typebox]: "0.34.52", [sdk]: "^0.1.0-rc.0" },
        scripts: { test: "node --version" },
      }),
    );
    const before = await readFile(packageFile, "utf8");
    const result = await initTaskBundle(join(root, "tasks", "echo task"));
    assert.equal(result.dependencyAdded, false);
    assert.equal(result.buildScriptAdded, false);
    assert.equal(result.cleanScriptAdded, false);
    assert.ok(!result.files.includes(packageFile));
    assert.equal(await readFile(packageFile, "utf8"), before);
    assert.deepEqual((await readJson(packageFile)).scripts, {
      test: "node --version",
    });
    const second = await initTaskBundle(join(root, "tasks", "second"));
    assert.equal(second.buildScriptAdded, false);
    assert.equal(second.cleanScriptAdded, false);
    assert.equal(await readFile(packageFile, "utf8"), before);
  });
});
test("init adds clean independently of build and removes only the task output", async () => {
  await fixture(async (root) => {
    const packageFile = join(root, "package.json");
    await writeFile(
      packageFile,
      JSON.stringify({
        private: true,
        dependencies: { [typebox]: "0.34.52", [sdk]: "0.1.0-rc.2" },
        scripts: { build: "custom-build" },
      }),
    );
    const target = root;
    const result = await initTaskBundle(target);
    assert.equal(result.buildScriptAdded, false);
    assert.equal(result.cleanScriptAdded, true);
    assert.ok(result.files.includes(packageFile));
    const scripts = (await readJson(packageFile)).scripts;
    assert.equal(scripts.build, "custom-build");
    assert.equal(
      scripts.clean,
      `node -e "for (const path of ['dist', 'dist.car']) require('node:fs').rmSync(path, { recursive: true, force: true })"`,
    );
    await mkdir(join(target, "dist"));
    await writeFile(join(target, "dist", "worker.cjs"), "generated");
    await writeFile(join(target, "dist.car"), "generated CAR");
    await mkdir(join(root, "other", "dist"), { recursive: true });
    await writeFile(join(root, "other", "dist", "keep.txt"), "keep");
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "keep.txt"), "dependency");
    const code = scripts.clean.slice('node -e "'.length, -1);
    await execute(process.execPath, ["-e", code], { cwd: root });
    await execute(process.execPath, ["-e", code], { cwd: root });
    assert.ok(!(await readdir(target)).includes("dist"));
    assert.ok(!(await readdir(target)).includes("dist.car"));
    assert.equal(await readFile(join(root, "other", "dist", "keep.txt"), "utf8"), "keep");
    assert.equal(await readFile(join(root, "node_modules", "keep.txt"), "utf8"), "dependency");
    assert.ok((await readdir(join(target, "src"))).includes("main.ts"));
    assert.ok((await readdir(target)).includes("task.build.yaml"));
  });
});
test("init adds build without replacing an existing clean script", async () => {
  await fixture(async (root) => {
    await writeFile(
      join(root, "package.json"),
      '{"private":true,"scripts":{"clean":"custom-clean"}}',
    );
    const result = await initTaskBundle(root);
    assert.equal(result.buildScriptAdded, true);
    assert.equal(result.cleanScriptAdded, false);
    assert.deepEqual((await readJson(result.packageFile)).scripts, {
      clean: "custom-clean",
      build: "pguide task-bundle build task.build.yaml",
    });
  });
});
test("init only adds the dependency to ancestor packages without introducing scripts", async () => {
  await fixture(async (root) => {
    await writeFile(join(root, "package.json"), '{"private":true}\n');
    const result = await initTaskBundle(join(root, "task$HOME"));
    assert.equal(result.dependencyAdded, true);
    assert.equal(result.buildScriptAdded, false);
    assert.equal(result.cleanScriptAdded, false);
    assert.deepEqual(await readJson(result.packageFile), {
      private: true,
      dependencies: { [typebox]: "0.34.52", [sdk]: "0.1.0-rc.2" },
    });
  });
});
test("init preserves existing TypeBox declarations and manifest bytes", async (t) => {
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ])
    await t.test(field, async () => {
      await fixture(async (root) => {
        const packageFile = join(root, "package.json");
        const source = `${JSON.stringify({ private: true, scripts: { build: "existing-build", clean: "existing-clean" }, [field]: { [typebox]: "catalog:", [sdk]: "workspace:^" } }, null, "\t")}\r\n`;
        await writeFile(packageFile, source);
        const result = await initTaskBundle(join(root, "task"));
        assert.equal(result.dependencyAdded, false);
        assert.equal(await readFile(packageFile, "utf8"), source);
        assert.equal(result.files.includes(packageFile), false);
      });
    });
});
test("malformed nearest manifests fail before creating templates instead of falling back upward", async (t) => {
  for (const source of [
    "{",
    "[]",
    "null",
    '{"dependencies":[]}',
    '{"devDependencies":{"bad":42}}',
    '{"dependencies":{"@sinclair/typebox":""}}',
    '{"scripts":[]}',
    '{"scripts":{"build":42}}',
  ])
    await t.test(source, async () => {
      await fixture(async (root) => {
        await writeFile(join(root, "package.json"), '{"private":true}\n');
        const inner = join(root, "inner");
        await mkdir(inner);
        const packageFile = join(inner, "package.json");
        await writeFile(packageFile, source);
        await assert.rejects(
          initTaskBundle(join(inner, "task")),
          /parse|object|version strings|command strings/,
        );
        assert.deepEqual((await readdir(inner)).sort(), ["package.json"]);
        assert.equal(await readFile(packageFile, "utf8"), source);
      });
    });
});
test("collisions and non-directory src paths never overwrite existing files or modify dependencies", async (t) => {
  for (const name of ["task.build.yaml", "src/main.ts", "src/contract.ts", "src"])
    await t.test(name, async () => {
      await fixture(async (root) => {
        const source = '{"private":true}\n';
        const packageFile = join(root, "package.json");
        await writeFile(packageFile, source);
        await mkdir(join(root, "src"));
        if (name === "src") await rm(join(root, "src"), { recursive: true });
        const collision = join(root, name);
        await writeFile(collision, "keep");
        const before = await readdir(root);
        await assert.rejects(initTaskBundle(root), /overwrite|regular directory/);
        assert.equal(await readFile(collision, "utf8"), "keep");
        assert.equal(await readFile(packageFile, "utf8"), source);
        assert.deepEqual(await readdir(root), before);
      });
    });
});
test("directory links, linked manifests and broken template links fail without following them", async (t) => {
  for (const kind of ["target", "src", "manifest", "hardlinked-manifest", "broken-template"])
    await t.test(kind, async (context) => {
      await fixture(async (root) => {
        const outside = join(root, "outside");
        const target = join(root, "task");
        await mkdir(outside);
        await mkdir(target);
        const original = join(outside, "package.json");
        await writeFile(original, '{"private":true}\n');
        if (kind === "target") {
          await rm(target, { recursive: true });
          await symlink(outside, target, process.platform === "win32" ? "junction" : "dir");
        } else if (kind === "src")
          await symlink(
            outside,
            join(target, "src"),
            process.platform === "win32" ? "junction" : "dir",
          );
        else if (kind === "manifest") {
          if (!(await fileSymlink(context, original, join(target, "package.json")))) return;
        } else if (kind === "hardlinked-manifest")
          await link(original, join(target, "package.json"));
        else {
          await mkdir(join(target, "src"));
          if (
            !(await fileSymlink(
              context,
              join(outside, "missing.ts"),
              join(target, "src", "main.ts"),
            ))
          )
            return;
        }
        await assert.rejects(initTaskBundle(target), /link|overwrite/);
        assert.deepEqual(await readdir(outside), ["package.json"]);
        assert.equal(await readFile(original, "utf8"), '{"private":true}\n');
      });
    });
});
test("CLI init honors cwd, defaults to it, returns the standard envelope and rejects unsupported arguments", async () => {
  await fixture(async (root) => {
    const bin = resolve("dist", "bin.js");
    const initialized = JSON.parse(
      (await execute(process.execPath, [bin, "init", "--cwd", root, "--format", "json"])).stdout,
    );
    assert.equal(initialized.schemaVersion, 1);
    assert.equal(initialized.command, "task-bundle init");
    assert.equal(initialized.status, "ok");
    assert.equal(initialized.result.directory, root);
    const nested = JSON.parse(
      (await execute(process.execPath, [bin, "init", "nested", "--cwd", root, "--format", "json"]))
        .stdout,
    );
    assert.equal(nested.result.directory, join(root, "nested"));
    assert.equal(nested.result.packageDirectory, root);
    assert.equal(nested.result.packageCreated, false);
    for (const args of [["init"], ["init", "a", "b"], ["init", "--unknown"]])
      await assert.rejects(
        execute(process.execPath, [bin, ...args, "--cwd", root, "--format", "json"]),
      );
    assert.deepEqual((await readdir(root)).sort(), [
      ".gitignore",
      "nested",
      "package.json",
      "src",
      "task.build.yaml",
    ]);
  });
});
