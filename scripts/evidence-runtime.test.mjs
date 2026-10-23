import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readArtifact } from "../packages/check-host/dist/index.js";
import { createWorkerCheckProbe, RunEvidence } from "../packages/objective-pilot/dist/index.js";
import { createWorkerHost } from "./worker-test-helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const scratch = join(root, ".cache");
await mkdir(scratch, { recursive: true });
const entries = [
  ["objective-devbox-health", "runtime/health-check.mjs", "system"],
  ["objective-pguide-setup", "runtime/setup-check.mjs", "installation"],
];

for (const [packageName, stage] of [
  ["objective-monorepo-standard", "structure"],
  ["objective-devbox-health", "system"],
  ["objective-pguide-setup", "installation"],
  ["objective-pguide-self-check", "installation"],
]) {
  test(`worker invocation failures retain caller-owned evidence for ${packageName}`, async () => {
    const directory = await mkdtemp(join(scratch, "evidence-worker-"));
    let host;
    try {
      host = await createWorkerHost(join(directory, "host"));
      const artifact = await readArtifact(join(root, "packages", packageName, "checks", stage));
      const evidence = new RunEvidence({ directory: join(directory, "reports") });
      const probe = createWorkerCheckProbe({
        directory: artifact.directory,
        revision: artifact.revision,
        evidence,
        identity: { packageName, stage },
      });
      const envelope = await probe({}, AbortSignal.timeout(30_000));
      assert.equal(envelope.payload, null);
      assert.notEqual(envelope.status, 200);
      const events = (await readFile(join(evidence.directory, "events.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const check = events.find(({ event }) => event === "check.started");
      assert.ok(check);
      assert.deepEqual(
        JSON.parse(
          await readFile(join(evidence.directory, check.data.directory, "result.json"), "utf8"),
        ),
        envelope,
      );
      assert.ok(events.some(({ event }) => event === "check.finished"));
      assert.equal(events.filter(({ event }) => event === "check.started").length, 1);
    } finally {
      try {
        await host?.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
}

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
