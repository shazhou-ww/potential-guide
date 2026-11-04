import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import spawn from "cross-spawn";
import { checkPackageConsumers } from "./check-package-consumers.mjs";
import { checkTaskBundleConsumer } from "./check-task-bundle-consumer.mjs";
import { verificationPackages } from "./release-packages.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pnpmCommand = "pnpm";
const bundlesOnly = process.argv.includes("--task-bundles");
const sdkOnly = process.argv.includes("--task-sdk");
const serviceOnly = process.argv.includes("--task-service");
const authoringOnly = process.argv.includes("--bundle-authoring");
if ([sdkOnly, bundlesOnly, serviceOnly, authoringOnly].filter(Boolean).length > 1)
  throw new Error("Select only one consumer scope.");
const authoringPackages = new Set([
  "pguide",
  "@potential-guide/pguide-task-bundle",
  "@potential-guide/task-engine",
]);
if (authoringOnly) {
  const pending = [...authoringPackages];
  for (const name of pending) {
    const entry = verificationPackages.find((entry) => entry.name === name);
    assert.ok(entry, `Missing verification package ${name}.`);
    const manifest = JSON.parse(
      await readFile(
        join(root, entry.workspace ?? "packages", entry.directory, "package.json"),
        "utf8",
      ),
    );
    for (const [dependency, version] of Object.entries({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    }))
      if (version.startsWith("workspace:") && !authoringPackages.has(dependency)) {
        authoringPackages.add(dependency);
        pending.push(dependency);
      }
  }
}
const sdkPackages = new Set([
  "ipfs-content",
  "check-runtime-files",
  "check-artifacts",
  "task-protocol",
  "task-sdk",
]);
const bundlePackages = new Set([
  "ipfs-content",
  "check-runtime-files",
  "check-artifacts",
  "task-protocol",
  "task-sdk",
  "task-engine",
  "task-engine-http",
  "task-engine-storage",
  "task-engine-server",
  "check-task",
  "probe-task",
]);
const packages =
  bundlesOnly || sdkOnly || authoringOnly
    ? verificationPackages.filter((entry) =>
        authoringOnly
          ? authoringPackages.has(entry.name)
          : (sdkOnly ? sdkPackages : bundlePackages).has(entry.directory),
      )
    : verificationPackages;
const manifests = new Map();

function run(command, args, cwd = root, env = process.env, expectedCode = 0) {
  return new Promise((resolve, reject) => {
    const options = { cwd, env, windowsHide: true };
    const child = spawn(command, args, { ...options, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === expectedCode) {
        resolve(stdout);
      } else {
        reject(new Error(`${command} exited ${String(code)}.\n${stderr}\n${stdout}`));
      }
    });
  });
}

await mkdir(join(root, ".cache"), { recursive: true });
const destination = await mkdtemp(join(root, ".cache", "potential-guide-packs-"));
const tarballs = new Map();
try {
  for (const expected of packages) {
    const packageRoot = join(root, expected.workspace ?? "packages", expected.directory);
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    manifests.set(manifest.name, manifest);
    assert.equal(manifest.name, expected.name);
    assert.deepEqual(Object.keys(manifest.bin ?? {}).sort(), [...(expected.bins ?? [])].sort());
    for (const dependency of expected.forbiddenRuntimeDependencies ?? []) {
      for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
        assert.equal(
          manifest[field]?.[dependency],
          undefined,
          `${expected.name}: ${field}.${dependency}`,
        );
      }
    }
    for (const dependency of expected.forbiddenDependencies ?? []) {
      for (const field of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
      ]) {
        assert.equal(
          manifest[field]?.[dependency],
          undefined,
          `${expected.name} must not declare ${dependency} in ${field}.`,
        );
      }
    }
    if (expected.requiredExports !== undefined) {
      assert.ok(Object.hasOwn(manifest.exports, "."));
      assert.deepEqual(Object.keys(manifest.exports["."]).sort(), ["import", "types"]);
      const module = await import(pathToFileURL(join(packageRoot, "dist", "index.js")).href);
      for (const name of expected.requiredExports) {
        assert.ok(Object.hasOwn(module, name), `${expected.name} must export ${name}.`);
      }
    }
    const packed = JSON.parse(
      await run(pnpmCommand, [
        "--dir",
        packageRoot,
        "pack",
        "--pack-destination",
        destination,
        "--json",
      ]),
    );
    assert.equal(packed.name, expected.name);
    assert.equal(packed.version, manifest.version);
    const files = packed.files.map(({ path }) => path);
    const output = expected.sourceOutputDirectory ?? "dist/";
    for (const file of files.filter((path) => path.startsWith(output) && path.endsWith(".js"))) {
      await assert.doesNotReject(
        Promise.any(
          ["ts", "tsx"].map((extension) =>
            access(join(packageRoot, "src", `${file.slice(output.length, -3)}.${extension}`)),
          ),
        ),
        `${expected.name} contains stale output ${file}; clean and rebuild before packing.`,
      );
    }
    for (const forbidden of expected.forbiddenFiles ?? []) {
      assert.ok(!files.includes(forbidden), `${expected.name} contains retired ${forbidden}.`);
    }
    for (const required of [
      ...(expected.requiredFiles ?? []),
      ...(expected.requiredExports === undefined ? [] : ["dist/index.js", "dist/index.d.ts"]),
      ...(expected.bins === undefined
        ? []
        : Object.values(manifest.bin ?? {}).map((path) => path.replace(/^\.\//, ""))),
      "LICENSE",
      "package.json",
      "README.md",
    ]) {
      assert.ok(files.includes(required), `${expected.name} is missing ${required}.`);
    }
    assert.ok(
      files.every(
        (path) =>
          !path.startsWith("src/") &&
          !path.startsWith("test/") &&
          !path.endsWith(".tsbuildinfo") &&
          !(
            (expected.forbiddenDependencies ?? []).includes("@potential-guide/cli-core") &&
            (path.startsWith("dist/bin/") || path.startsWith("dist/cli."))
          ),
      ),
      `${expected.name} contains development-only files.`,
    );
    await access(packed.filename);
    tarballs.set(expected.name, packed.filename);
    console.log(`${expected.name}: ${String(files.length)} packed files`);
  }
  if (bundlesOnly) await checkTaskBundleConsumer(destination, tarballs, manifests, run);
  else
    await checkPackageConsumers(
      root,
      destination,
      packages,
      tarballs,
      run,
      sdkOnly
        ? "task-sdk"
        : serviceOnly
          ? "task-service"
          : authoringOnly
            ? "bundle-authoring"
            : undefined,
    );
} finally {
  if (process.env.PGUIDE_KEEP_PACK_CONSUMERS === "1")
    console.log(`Owned consumer fixtures retained: ${destination}`);
  else await rm(destination, { recursive: true, force: true });
}
