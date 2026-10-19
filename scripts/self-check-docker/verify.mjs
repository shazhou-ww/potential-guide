import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [mode, ...extra] = process.argv.slice(2);
assert.ok(["fix", "wrong", "summary-only"].includes(mode) && extra.length === 0);
assert.notEqual(process.getuid(), 0, "Run as the image's non-root user");
const provenance = JSON.parse(await readFile("/harness/provenance.json", "utf8"));
const run = await mkdtemp(`/work/runs/${mode}-`);
const configPath = join(run, "config.json");
const subjectPath = join(run, "subject.json");
const log = join(run, "prompts.jsonl");
const scratch = join(run, "scratch");
await mkdir(scratch);
await writeFile(join(scratch, "keep.txt"), "unrelated scratch survives");
await writeFile(log, "");
await writeFile(
  configPath,
  JSON.stringify({
    schemaVersion: 2,
    commandDirectories: ["/opt/consumer/node_modules/.bin"],
    defaultAgent: "fixture",
    agents: {
      fixture: {
        connection: { type: "acp", protocolVersion: "1" },
        transport: {
          type: "stdio",
          command: "/usr/local/bin/node",
          args: ["/harness/fixture.mjs", mode, log],
        },
      },
    },
  }),
);
await writeFile(
  subjectPath,
  JSON.stringify({
    workingDirectory: run,
    configPath,
    scratchDirectory: scratch,
    pguide: { command: "/opt/consumer/node_modules/.bin/pguide" },
    desiredVersion: provenance.pguideVersion,
    agent: "fixture",
    userHome: "/work/home",
    timeoutMs: 24000,
  }),
);
const pilot = "git+file:///opt/objective#objectives/pguide-self-check/pilot.yaml";
const result = spawnSync(
  "/opt/consumer/node_modules/.bin/pguide",
  [
    "probe",
    "--pilot",
    pilot,
    "--revision",
    provenance.objectiveRevision,
    "--config",
    configPath,
    "--subject-file",
    subjectPath,
    "--format",
    "json",
  ],
  {
    cwd: run,
    encoding: "utf8",
    timeout: 90000,
    maxBuffer: 1024 * 1024,
    // Explicit allowlist, not the host or docker-exec environment.
    env: {
      HOME: "/work/home",
      PATH: "/opt/consumer/node_modules/.bin:/usr/local/bin:/usr/bin:/bin",
      LANG: "C.UTF-8",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  },
);
await writeFile(join(run, "probe.json"), result.stdout ?? "");
assert.equal(result.error, undefined, "Probe must finish within its outer deadline");
assert.equal(result.status, 0, `Probe failed: ${result.stderr}`);
const observation = JSON.parse(result.stdout);
assert.equal(observation.status, 200);
assert.equal(observation.payload.versions[pilot], provenance.objectiveRevision);
const prompts = (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
assert.deepEqual(prompts, [{ method: "session/prompt", mode }], "Exactly one prompt per probe");
assert.deepEqual(await readdir(scratch), ["keep.txt"], "Owned task scratch must be cleaned");
assert.equal(await readFile(join(scratch, "keep.txt"), "utf8"), "unrelated scratch survives");
if (mode === "fix") {
  assert.equal(observation.payload.current.levelId, "terminal");
  assert.deepEqual(observation.payload.problems, []);
} else {
  assert.equal(observation.payload.current.levelId, "configured");
  assert.ok(observation.payload.problems.some(({ ref }) => ref.problemId === "sanity-failed"));
}
const report = {
  mode,
  run,
  ...provenance,
  level: observation.payload.current.levelId,
  promptCount: prompts.length,
  scratchCleaned: true,
  verified: true,
};
await writeFile(join(run, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
