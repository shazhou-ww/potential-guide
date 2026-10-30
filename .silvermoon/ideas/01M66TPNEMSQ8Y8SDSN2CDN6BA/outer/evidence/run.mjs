import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";

const root = process.cwd();
const evidence = dirname(fileURLToPath(import.meta.url));
assert.equal(resolve(evidence, "..", "..", "..", "..", ".."), root);
const candidate = "8ebcaa9a22d95553aa479a315c4ed88e11740f8b";
const source = "533f88485acfa75fc00b5e349ff88b7cb2e18f26";
const contract = "23986aa273d235c16c4109a9edbf0e279bd5933d";
const directory = join(root, ".cache", `task-history-query-proof-${randomUUID()}`);
const consumer = join(directory, "consumer");
const artifacts = join(directory, "tarballs");
const result = {
  candidate,
  source,
  acceptedInnerRevision: "33a3627d9baf20f0741c0908e0a559d6c1426862",
  deploymentRevision: contract,
  eventsDigest: "f9fc88a169fa6b1501162541114dd9de53356482",
  node: process.version,
  startedAt: new Date().toISOString(),
  directory,
  consumer,
  commands: [],
  packages: {},
};
function git(args) {
  const child = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout.trim();
}
assert.equal(git(["rev-parse", "HEAD"]), candidate);
assert.equal(
  git(["rev-parse", `${candidate}:.silvermoon/ideas/01M66TPNEMSQ8Y8SDSN2CDN6BA/outer`]),
  contract,
);
assert.equal(
  git([
    "diff",
    source,
    candidate,
    "--",
    "packages/task-protocol",
    "packages/task-engine",
    "packages/task-engine-http",
    "packages/task-engine-storage",
    "packages/task-engine-server",
  ]),
  "",
);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
function run(args, cwd = root) {
  const child = spawn.sync(pnpm, args, {
    cwd,
    encoding: "utf8",
    timeout: 180_000,
    env: { ...process.env, npm_config_cache: join(directory, "npm-cache") },
  });
  result.commands.push({ command: `pnpm ${args.join(" ")}`, cwd, exitCode: child.status });
  if (child.status !== 0)
    throw new Error(`pnpm ${args.join(" ")}: ${child.stdout}\n${child.stderr}`);
}
await mkdir(directory, { recursive: false });
try {
  await mkdir(consumer);
  await mkdir(artifacts);
  const manifests = new Map();
  for (const folder of await readdir(join(root, "packages"))) {
    const path = join(root, "packages", folder);
    const manifest = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    manifests.set(manifest.name, { path, manifest });
  }
  const selected = new Set();
  function visit(name) {
    if (selected.has(name)) return;
    selected.add(name);
    for (const dependency of Object.keys(manifests.get(name).manifest.dependencies ?? {}))
      if (manifests.has(dependency)) visit(dependency);
  }
  visit("@potential-guide/task-engine-server");
  const dependencies = {};
  for (const name of [...selected].sort()) {
    const item = manifests.get(name);
    const target = join(artifacts, `${name.split("/")[1]}.tgz`);
    run(["--dir", item.path, "pack", "--out", target]);
    dependencies[name] = `file:${target.replaceAll("\\", "/")}`;
    result.packages[name] = {
      version: item.manifest.version,
      sha256: createHash("sha256")
        .update(await readFile(target))
        .digest("hex"),
      bytes: (await stat(target)).size,
      sourceTree: git([
        "rev-parse",
        `${candidate}:${relative(root, item.path).replaceAll("\\", "/")}`,
      ]),
    };
  }
  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify(
      {
        name: "task-history-query-isolated-proof",
        private: true,
        type: "module",
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumer, "pnpm-workspace.yaml"),
    `packages: []\noverrides:\n${Object.entries(dependencies)
      .map(([name, path]) => `  ${JSON.stringify(name)}: ${JSON.stringify(path)}`)
      .join("\n")}\n`,
  );
  run(
    [
      "install",
      "--ignore-scripts",
      "--store-dir",
      join(directory, "pnpm-store"),
      "--cache-dir",
      join(directory, "pnpm-cache"),
    ],
    consumer,
  );
  result.lockSha256 = createHash("sha256")
    .update(await readFile(join(consumer, "pnpm-lock.yaml")))
    .digest("hex");
  for (const file of ["host.mjs", "client.mjs", "verify.mjs"])
    await copyFile(join(evidence, file), join(consumer, file));
  const verification = spawnSync(process.execPath, ["verify.mjs"], {
    cwd: consumer,
    encoding: "utf8",
    timeout: 180_000,
  });
  result.verificationExitCode = verification.status;
  result.proof = JSON.parse(await readFile(join(consumer, "result.json"), "utf8"));
  assert.equal(verification.status, 0, JSON.stringify(result.proof.failure ?? verification.stderr));
  assert.equal(result.proof.success, true);
  result.success = true;
} catch (error) {
  result.success = false;
  result.failure = error.message;
  process.exitCode = 1;
} finally {
  // 唯一 UUID 路径由本次创建；没有清理任何共享缓存、其他 idea 或来源工作树。
  await rm(directory, { recursive: true, force: true });
  result.directoryRemoved = await stat(directory).then(
    () => false,
    () => true,
  );
  assert.equal(result.directoryRemoved, true);
  result.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    JSON.stringify({
      success: result.success,
      checks: result.proof?.checks.length,
      directoryRemoved: result.directoryRemoved,
      failure: result.failure,
    }),
  );
}
