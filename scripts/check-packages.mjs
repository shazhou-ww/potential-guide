import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pnpmCommand = "pnpm";
const packages = [
  {
    directory: "pguide-cli-core",
    name: "@potential-guide/cli-core",
    exports: [
      "AcpClient",
      "COMMAND_PROTOCOL",
      "CliError",
      "atomicWrite",
      "commandMain",
      "digest",
      "digestTree",
      "duration",
      "ensurePrivateDirectory",
      "expectedCliError",
      "extractGlobals",
      "loadConfig",
      "option",
      "parseConfig",
      "pruneExpiredRegulations",
      "readJsonSubject",
      "readStdin",
      "redactConfig",
      "redactSensitive",
      "rejectUnknownOptions",
      "stateRoot",
      "userConfigPath",
      "validateAgentProfile",
      "writeResult",
    ],
  },
  {
    directory: "objective-guide",
    name: "@potential-guide/objective-guide",
    exports: [
      "ObjectiveConfigurationError",
      "ObjectiveOperationError",
      "SUBJECT_PROJECTION_LIMITS",
      "canonicalManifestUri",
      "createObjectiveLoader",
      "fileObjectiveCheckRunner",
      "fileObjectiveResources",
    ],
    bins: ["pguide-probe", "pguide-scaffold", "pguide-validate"],
  },
  {
    directory: "objective-regulator",
    name: "@potential-guide/objective-regulator",
    exports: [
      "ObjectiveRegulatorError",
      "ObjectiveRegulatorTimeoutError",
      "createObjectiveRegulator",
    ],
    bins: ["pguide-regulate", "pguide-continue"],
  },
  {
    directory: "objective-portfolio-supervisor",
    name: "@potential-guide/objective-portfolio-supervisor",
    exports: ["ObjectivePortfolioError", "createObjectivePortfolioSupervisor"],
    bins: ["pguide-supervise"],
  },
  {
    directory: "pguide-config",
    name: "pguide-config",
    bins: ["pguide-config"],
  },
  {
    directory: "pguide",
    name: "pguide",
    bins: ["pguide"],
  },
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const options = { cwd: root, windowsHide: true };
    const child =
      process.platform === "win32"
        ? spawn(
            [
              command,
              ...args.map((value) => `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`),
            ].join(" "),
            { ...options, shell: true },
          )
        : spawn(command, args, options);
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
    if (expected.exports !== undefined) {
      assert.deepEqual(Object.keys(manifest.exports), ["."]);
      assert.deepEqual(Object.keys(manifest.exports["."]).sort(), ["import", "types"]);
      const module = await import(pathToFileURL(join(packageRoot, "dist", "index.js")).href);
      assert.deepEqual(Object.keys(module).sort(), [...expected.exports].sort());
    }
    for (const bin of expected.bins ?? []) {
      assert.equal(typeof manifest.bin[bin], "string");
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
    const files = packed.files.map(({ path }) => path);
    for (const required of [
      ...(expected.exports === undefined ? [] : ["dist/index.js", "dist/index.d.ts"]),
      ...(expected.bins === undefined
        ? []
        : Object.values(manifest.bin).map((path) => path.replace(/^\.\//, ""))),
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
