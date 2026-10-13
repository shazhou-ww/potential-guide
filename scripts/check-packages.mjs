import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pnpmCommand = process.platform === "win32" ? "pnpm.exe" : "pnpm";
const packages = [
  {
    directory: "objective-guide",
    name: "@potential-guide/objective-guide",
    exports: [
      "ObjectiveConfigurationError",
      "ObjectiveOperationError",
      "SUBJECT_PROJECTION_LIMITS",
      "canonicalManifestUri",
      "createObjectiveLoader",
      "fileObjectiveResources",
    ],
  },
  {
    directory: "objective-regulator",
    name: "@potential-guide/objective-regulator",
    exports: [
      "ObjectiveRegulatorError",
      "ObjectiveRegulatorTimeoutError",
      "createObjectiveRegulator",
    ],
  },
  {
    directory: "objective-portfolio-supervisor",
    name: "@potential-guide/objective-portfolio-supervisor",
    exports: ["ObjectivePortfolioError", "createObjectivePortfolioSupervisor"],
  },
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      windowsHide: true,
    });
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
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${command} exited ${String(code)}.\n${stderr}`));
      }
    });
  });
}

const destination = await mkdtemp(join(tmpdir(), "potential-guide-packs-"));
try {
  for (const expected of packages) {
    const packageRoot = join(root, "packages", expected.directory);
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    assert.equal(manifest.name, expected.name);
    assert.deepEqual(Object.keys(manifest.exports), ["."]);
    assert.deepEqual(Object.keys(manifest.exports["."]).sort(), ["import", "types"]);

    const module = await import(pathToFileURL(join(packageRoot, "dist", "index.js")).href);
    assert.deepEqual(Object.keys(module).sort(), [...expected.exports].sort());

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
    const files = packed.files.map(({ path }) => path);
    for (const required of [
      "dist/index.js",
      "dist/index.d.ts",
      "LICENSE",
      "package.json",
      "README.md",
    ]) {
      assert.ok(files.includes(required), `${expected.name} is missing ${required}.`);
    }
    assert.ok(
      files.every(
        (path) =>
          !path.startsWith("src/") && !path.startsWith("test/") && !path.endsWith(".tsbuildinfo"),
      ),
      `${expected.name} contains development-only files.`,
    );
    await access(packed.filename);
    console.log(`${expected.name}: ${String(files.length)} packed files`);
  }
} finally {
  await rm(destination, { recursive: true, force: true });
}
