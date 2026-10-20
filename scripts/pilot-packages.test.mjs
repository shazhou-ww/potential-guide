import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  fileResources,
  loadPilotSpec,
  parseObjectives,
  projectObjective,
} from "../packages/objective-pilot/dist/index.js";
import { execute } from "./verify-deployment-helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const scratchRoot = join(root, ".cache");
await mkdir(scratchRoot, { recursive: true });
const tmpdir = () => scratchRoot;
const pilots = [
  ["objective-monorepo-standard", "check.mjs", ["structure", "deliveries"]],
  ["objective-pguide-setup", "setup-check.mjs", ["installation", "configuration", "sanity"]],
  ["objective-pguide-self-check", "self-check.mjs", ["installation", "configuration", "sanity"]],
  [
    "objective-devbox-health",
    "health-check.mjs",
    ["identity", "system", "toolchains", "order", "sustainability"],
  ],
];

test("every Objective instance uses a matching objective-prefixed workspace name", async () => {
  const directories = (await readdir(join(root, "packages"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((directory) => existsSync(join(root, "packages", directory, "objective.yaml")));
  assert.deepEqual(directories.sort(), pilots.map(([directory]) => directory).sort());
  for (const directory of directories) {
    assert.match(directory, /^objective-[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const manifest = JSON.parse(
      await readFile(join(root, "packages", directory, "package.json"), "utf8"),
    );
    assert.equal(manifest.name, `@potential-guide/${directory}`);
  }
});

test("dist outputs are ignored while standalone Pilot runtimes remain versionable", async () => {
  const outputs = [
    "dist/probe.js",
    "packages/future-objective/dist/probe.js",
    ...pilots.map(([directory]) => `packages/${directory}/dist/probe.js`),
  ];
  const result = await execute("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: root,
    input: `${outputs.join("\n")}\npackages/objective-monorepo-standard/runtime/pilot-checker.cjs\n`,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), outputs);
});

test("all private Pilot tarballs include same-version resources and run without dependency installation", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pguide-pilot-packs-"));
  try {
    const packs = join(scratch, "packs");
    await mkdir(packs);
    const version = join(scratch, "version.mjs");
    await writeFile(
      version,
      'console.log(JSON.stringify({schemaVersion:1,name:"pguide",version:"fixture"}));',
    );
    for (const [directory, entry, checks] of pilots) {
      const packed = await execute(
        "pnpm",
        ["--dir", join(root, "packages", directory), "pack", "--pack-destination", packs, "--json"],
        { cwd: root },
      );
      assert.equal(packed.code, 0, packed.stderr);
      const pack = JSON.parse(packed.stdout);
      const paths = pack.files.map(({ path }) => path);
      for (const required of ["package.json", "README.md", "objective.yaml", entry])
        assert.ok(paths.includes(required), `${directory} missing ${required}`);
      assert.ok(
        paths.every((path) => !path.startsWith("node_modules/") && !path.startsWith("test/")),
      );
      const consumer = join(scratch, directory);
      await mkdir(consumer);
      const extract = await execute("tar", ["-xf", pack.filename, "-C", consumer]);
      assert.equal(extract.code, 0, extract.stderr);
      const packageRoot = join(consumer, "package");
      const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
      assert.equal(manifest.private, true);
      const spec = await loadPilotSpec(packageRoot, fileResources);
      assert.deepEqual(
        spec.manifest.levels.flatMap((level) => level.checks.map((check) => check.id)),
        checks,
      );
      const subject =
        directory === "objective-monorepo-standard"
          ? projectObjective(
              parseObjectives(
                await readFile(join(root, "packages", directory, "objectives.yaml"), "utf8"),
              ).standardize,
              {
                repo: { rootPath: root, origin: null },
                path: `packages/${directory}`,
              },
              undefined,
            )
          : {
              workingDirectory: scratch,
              configPath: join(scratch, "unused-config.json"),
              scratchDirectory: join(scratch, "tasks"),
              pguide: { command: process.execPath, args: [version] },
            };
      const call = async (stage, value) => {
        const result = await execute(
          process.execPath,
          [
            join(
              packageRoot,
              ...(directory === "objective-monorepo-standard" ? ["package-standard"] : []),
              "checks",
              stage,
              "run.cjs",
            ),
          ],
          {
            cwd: consumer,
            input: JSON.stringify(value),
            env: { ...process.env, NODE_PATH: "", PGUIDE_STATE_DIRECTORY: join(scratch, "state") },
          },
        );
        assert.equal(result.code, 0, result.stderr);
        return JSON.parse(result.stdout);
      };
      const invalid = await call(checks[0], {});
      assert.equal(invalid.payload, null);
      assert.notEqual(invalid.status, 200);
      if (directory !== "objective-devbox-health") {
        const result = await call(checks[0], subject);
        assert.equal(result.status, 200, JSON.stringify(result));
        assert.equal(result.payload.ok, true, JSON.stringify(result));
      }
      if (directory === "objective-pguide-setup") {
        for (const resource of ["objective.yaml", "gitignore"])
          assert.ok(paths.includes(`sanity-fixture/${resource}`));
        const { sshRequest } = await import(
          pathToFileURL(join(packageRoot, "ssh-target.mjs")).href
        );
        const request = await sshRequest("installation", {
          target: { type: "ssh", host: "fixture", shell: "posix" },
          workingDirectory: "/home/fixture",
          configPath: "/home/fixture/config.json",
          scratchDirectory: "/home/fixture/tmp",
          pguide: { command: "pguide" },
        });
        const payload = JSON.parse(request.input);
        assert.equal(Object.keys(payload.files).length, 11);
        assert.equal(payload.files["sanity-fixture/gitignore"], "marker.txt\n.cache/\n");
      }
      if (directory === "objective-monorepo-standard")
        for (const resource of [
          "runtime/pilot-checker.cjs",
          "package-standard/objective.yaml",
          "package-standard/runtime/pilot-checker.cjs",
        ])
          assert.ok(paths.includes(resource));
    }
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
});
