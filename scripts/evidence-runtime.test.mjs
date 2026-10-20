import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const scratch = join(root, ".cache");
await mkdir(scratch, { recursive: true });
const entries = [
  ["objective-monorepo-standard", "checks/structure/run.cjs"],
  ["objective-devbox-health", "checks/system/run.cjs"],
  ["objective-devbox-health", "runtime/health-check.mjs", "system"],
  ["objective-pguide-setup", "checks/installation/run.cjs"],
  ["objective-pguide-setup", "runtime/setup-check.mjs", "installation"],
  ["objective-pguide-self-check", "checks/installation/run.cjs"],
];

for (const [packageName, entry, ...args] of entries) {
  test(`standalone evidence survives ${packageName}/${entry} invocation failure without changing stdout`, async (t) => {
    const directory = await mkdtemp(join(scratch, "evidence-runtime-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const child = spawn(
      process.execPath,
      [
        join(root, "packages", packageName, ...entry.split("/")),
        ...args,
        "--report-dir",
        directory,
      ],
      {
        env: {
          ...process.env,
          PGUIDE_EVIDENCE_CONTEXT: undefined,
          PGUIDE_EVIDENCE_DISABLED: undefined,
        },
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const completed = new Promise((done, reject) => {
      child.once("error", reject);
      child.once("close", done);
    });
    child.stdin.end("{}");
    assert.equal(await completed, 0, stderr);
    const envelope = JSON.parse(stdout);
    assert.equal(envelope.payload, null);
    assert.notEqual(envelope.status, 200);
    const [runId] = await readdir(directory);
    assert.ok(runId);
    const runDirectory = join(directory, runId);
    const events = (await readFile(join(runDirectory, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const check = events.find(({ event }) => event === "check.started");
    const checkDirectory = join(runDirectory, check.data.directory);
    assert.deepEqual(
      JSON.parse(await readFile(join(checkDirectory, "result.json"), "utf8")),
      envelope,
    );
    assert.match(await readFile(join(checkDirectory, "events.jsonl"), "utf8"), /business.finished/);
  });
}
