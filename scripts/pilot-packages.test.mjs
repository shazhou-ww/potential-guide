import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fileResources, loadPilotSpec } from "../packages/objective-pilot/dist/index.js";
import { execute } from "./verify-deployment-helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pilots = [
  ["monorepo-objective", "check.mjs", ["structure", "deliveries"]],
  ["pguide-setup-pilot", "setup-check.mjs", ["installation", "configuration", "sanity"]],
  ["pguide-self-check-pilot", "self-check.mjs", ["installation", "configuration", "sanity"]],
  [
    "development-machine-health-pilot",
    "health-check.mjs",
    ["identity", "system", "toolchains", "order", "sustainability"],
  ],
];

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
      for (const required of ["package.json", "README.md", "pilot.yaml", entry])
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
      const spec = await loadPilotSpec(join(packageRoot, "pilot.yaml"), fileResources);
      assert.deepEqual(
        spec.manifest.levels.flatMap((level) => level.advancement.checks.map((check) => check.id)),
        checks,
      );
      const subject =
        directory === "monorepo-objective"
          ? { root, contract: "config/monorepo-requirements.json" }
          : {
              workingDirectory: scratch,
              configPath: join(scratch, "unused-config.json"),
              scratchDirectory: join(scratch, "tasks"),
              pguide: { command: process.execPath, args: [version] },
            };
      const call = async (stage, value) => {
        const result = await execute(
          process.execPath,
          [join(packageRoot, "checks", stage, "run.cjs")],
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
      if (directory !== "development-machine-health-pilot") {
        const result = await call(checks[0], subject);
        assert.equal(result.status, 200, JSON.stringify(result));
        assert.equal(result.payload.ok, true, JSON.stringify(result));
      }
      if (directory === "pguide-setup-pilot") {
        for (const resource of ["pilot.yaml", "gitignore"])
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
      if (directory === "monorepo-objective") assert.ok(paths.includes("dist/pilot-checker.cjs"));
    }
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
});
