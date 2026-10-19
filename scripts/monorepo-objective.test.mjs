import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { main } from "../objectives/pnpm-monorepo/check.mjs";
import { Effect } from "../packages/effects/dist/index.js";
import {
  createProcessCheckProbe,
  fileResources,
  loadPilotSpec,
  observe,
  parseCheckEnvelope,
} from "../packages/objective-pilot/dist/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = pathToFileURL(join(root, "objectives", "pnpm-monorepo", "pilot.yaml")).href;
const contract = "objectives/pnpm-monorepo/examples/repository.json";
const checkerModule = join(root, "packages", "monorepo-objective", "dist", "index.js");
const subject = { root, contract, checkerModule };
async function fixtureSpec() {
  const objectiveId =
    "git+https://example.test/monorepo-fixture.git#objectives/pnpm-monorepo/pilot.yaml";
  function local(uri) {
    return pathToFileURL(join(root, decodeURIComponent(new URL(uri).hash.slice(1)))).href;
  }
  return loadPilotSpec(objectiveId, {
    version: "a".repeat(40),
    readText: (uri) => fileResources.readText(local(uri)),
    async readPages(uri) {
      return (await fileResources.readPages(local(uri))).map((page) => {
        const remote = new URL(objectiveId);
        remote.hash = relative(root, fileURLToPath(page.uri)).split("\\").join("/");
        return { ...page, uri: remote.href };
      });
    },
  });
}

test("real repository manifest and process probes advance through both layers to terminal", async () => {
  const spec = await loadPilotSpec(manifest, fileResources);
  assert.equal(spec.manifest.levels.length, 2);
  const runnable = await fixtureSpec();
  const calls = [];
  const result = await Effect.runPromise(
    observe(
      { spec: runnable, subject },
      {
        resolveCheck(ref) {
          calls.push(ref.checkId);
          return createProcessCheckProbe({
            command: process.execPath,
            args: [join(root, "objectives", "pnpm-monorepo", "checks", ref.checkId, "run.cjs")],
            cwd: root,
          });
        },
      },
    ),
  );
  assert.equal(result.status, 200, result.message);
  assert.deepEqual(calls, ["structure", "deliveries"]);
  assert.equal(result.payload.current.levelId, "terminal");
  assert.deepEqual(result.payload.problems, []);
  const report = JSON.parse((await main("deliveries", subject)).message);
  assert.equal(report.onlineVerified, false);
  assert.ok(report.limitations.length > 0);
});

test("direct adapter emits the existing check envelope and invalid invocation never returns ok", async () => {
  const structure = parseCheckEnvelope(await main("structure", subject));
  assert.equal(structure.payload.ok, true);
  const deliveries = parseCheckEnvelope(await main("deliveries", subject));
  assert.equal(deliveries.payload.ok, true);
  await assert.rejects(main("structure", { ...subject, root: "relative" }));
  const probe = createProcessCheckProbe({
    command: process.execPath,
    args: [join(root, "objectives", "pnpm-monorepo", "checks", "structure", "run.cjs")],
    cwd: root,
  });
  const invalid = await probe({ root }, new AbortController().signal);
  assert.equal(invalid.status, 422);
  assert.equal(invalid.payload, null);
});

test("real probe stops at structure for invalid contract and does not fall through to deliveries", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "monorepo-pilot-"));
  try {
    await writeFile(join(temporary, "requirements.json"), '{"schemaVersion":99}');
    const spec = await fixtureSpec();
    const calls = [];
    const result = await Effect.runPromise(
      observe(
        { spec, subject: { root: temporary, contract: "requirements.json", checkerModule } },
        {
          resolveCheck(ref) {
            calls.push(ref.checkId);
            return createProcessCheckProbe({
              command: process.execPath,
              args: [join(root, "objectives", "pnpm-monorepo", "checks", ref.checkId, "run.cjs")],
              cwd: root,
            });
          },
        },
      ),
    );
    assert.equal(result.status, 200);
    assert.equal(result.payload.current.levelId, "initial");
    assert.deepEqual(calls, ["structure"]);
    assert.equal(
      await readFile(join(temporary, "requirements.json"), "utf8"),
      '{"schemaVersion":99}',
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a valid internal package reaches Pilot terminal without execution or online proof", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "monorepo-terminal-"));
  try {
    await mkdir(join(temporary, "packages", "shared", "src"), { recursive: true });
    await writeFile(
      join(temporary, "package.json"),
      JSON.stringify({ name: "fixture", private: true }),
    );
    await writeFile(join(temporary, "README.md"), "# Fixture");
    await writeFile(join(temporary, "pnpm-workspace.yaml"), "packages: [packages/*]");
    await writeFile(
      join(temporary, "turbo.json"),
      JSON.stringify({ tasks: { build: { outputs: ["dist/**"] } } }),
    );
    await writeFile(
      join(temporary, "packages", "shared", "package.json"),
      JSON.stringify({ name: "shared", private: true, scripts: { build: "MUST_NOT_EXECUTE" } }),
    );
    await writeFile(join(temporary, "packages", "shared", "README.md"), "# Shared");
    await writeFile(
      join(temporary, "packages", "shared", "src", "index.ts"),
      "export const value = 1;",
    );
    await writeFile(
      join(temporary, "requirements.json"),
      JSON.stringify({
        schemaVersion: 1,
        policy: {
          source: "pnpm-default-v1",
          directories: { apps: "apps", packages: "packages", docs: "docs", scripts: "scripts" },
          requiredFiles: [],
          exceptions: [],
          assignments: [],
          allowedDirectories: [],
          dependencyExceptions: [],
        },
        workspaces: [
          {
            name: "shared",
            path: "packages/shared",
            roles: ["internal"],
            runtime: "universal",
            allows: [],
            entries: ["src/index.ts"],
            sources: ["src/index.ts"],
            tasks: ["build"],
          },
        ],
        deliveries: [],
      }),
    );
    const input = { root: temporary, contract: "requirements.json", checkerModule };
    const calls = [];
    const spec = await fixtureSpec();
    const runtime = {
      resolveCheck(ref) {
        calls.push(ref.checkId);
        return createProcessCheckProbe({
          command: process.execPath,
          args: [join(root, "objectives", "pnpm-monorepo", "checks", ref.checkId, "run.cjs")],
          cwd: root,
        });
      },
    };
    const result = await Effect.runPromise(observe({ spec, subject: input }, runtime));
    assert.equal(result.status, 200, result.message);
    assert.equal(result.payload.current.levelId, "terminal");
    assert.deepEqual(result.payload.problems, []);
    assert.deepEqual(calls, ["structure", "deliveries"]);
    const envelope = await main("deliveries", input);
    assert.equal(envelope.payload.ok, true);
    const report = JSON.parse(envelope.message);
    assert.equal(report.state, "pass");
    assert.equal(report.onlineVerified, false);
    assert.ok(report.limitations.length > 0);
    await writeFile(
      join(temporary, "packages", "shared", "src", "index.ts"),
      "import './missing.js';",
    );
    const blocked = await Effect.runPromise(observe({ spec, subject: input }, runtime));
    assert.equal(blocked.status, 200);
    assert.equal(blocked.payload.current.levelId, "structured");
    assert.equal(blocked.payload.problems[0].ref.problemId, "delivery-incomplete");
    assert.equal(blocked.payload.problems[0].parameters.report.state, "unverified");
    assert.equal(
      blocked.payload.problems[0].parameters.report.findings.some(
        (finding) => finding.rule === "source-import-resolution" && finding.state === "unverified",
      ),
      true,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
