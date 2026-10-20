import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  CheckEvidence,
  createMemoryCheckProbe,
  createProcessCheckProbe,
  RunEvidence,
  withCheckEvidence,
} from "../src/index.js";

const scratch = resolve(".cache");
await mkdir(scratch, { recursive: true });
const signal = new AbortController().signal;
const passed = { status: 200, payload: { ok: true, problems: [] }, message: "" } as const;

interface Event {
  schemaVersion: number;
  time: string;
  seq: number;
  runId: string;
  checkRunId?: string;
  event: string;
  data: Record<string, unknown>;
}
async function events(directory: string): Promise<Event[]> {
  const values: Event[] = (await readFile(join(directory, "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const [index, entry] of values.entries()) {
    assert.equal(entry.schemaVersion, 1);
    assert.equal(entry.seq, index + 1);
    assert.ok(Number.isFinite(Date.parse(entry.time)));
  }
  return values;
}

test("runs isolate identities, retries increment attempts and preserve business-failure envelopes", async (t) => {
  const directory = await mkdtemp(join(scratch, "evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const run = new RunEvidence({ directory });
  const other = new RunEvidence({ directory });
  assert.notEqual(run.runId, other.runId);
  const result = {
    status: 200,
    payload: { ok: false, problems: [{ id: "missing", parameters: { actual: 2, expected: 3 } }] },
    message: "",
  } as const;
  const probe = createMemoryCheckProbe(() => result, { evidence: run, identity: "ready" });
  for (let index = 0; index < 2; index++) assert.deepEqual(await probe({}, signal), result);
  const entries = await events(run.directory);
  const starts = entries.filter(({ event }) => event === "check.started");
  assert.deepEqual(
    starts.map(({ data }) => data.attempt),
    [1, 2],
  );
  assert.notEqual(starts[0]?.data.checkRunId, starts[1]?.data.checkRunId);
  for (const start of starts) {
    const path = join(run.directory, String(start.data.directory), "result.json");
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), result);
  }
});

test("business evidence has separate seq, safe facts and relative artifacts", async (t) => {
  const directory = await mkdtemp(join(scratch, "evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.deepEqual(
    await withCheckEvidence(
      "ready",
      async (evidence) => {
        assert.ok(evidence);
        evidence.stream.protect({ password: "unique-secret-value" });
        evidence.fact("assertion.result", {
          actual: 2,
          expected: 3,
          password: "not-saved",
          text: "unique-secret-value",
        });
        evidence.artifact("proof/summary.txt", "safe proof");
        evidence.artifact("other.txt", "another proof");
        return passed;
      },
      { directory },
    ),
    passed,
  );
  const [runId] = await readdir(directory);
  assert.ok(runId);
  const runDirectory = join(directory, runId);
  const root = await events(runDirectory);
  const start = root.find(({ event }) => event === "check.started");
  assert.ok(start);
  const checkDirectory = join(runDirectory, String(start.data.directory));
  const business = await events(checkDirectory);
  assert.ok(
    business.every((entry) => entry.runId === runId && entry.checkRunId === start.data.checkRunId),
  );
  const fact = business.find(({ event }) => event === "assertion.result");
  assert.deepEqual(fact?.data, {
    actual: 2,
    expected: 3,
    password: "[REDACTED]",
    text: "[REDACTED]",
  });
  assert.equal(
    await readFile(join(checkDirectory, "artifacts", "proof", "summary.txt"), "utf8"),
    "safe proof",
  );
  assert.equal(business.at(-1)?.event, "business.finished");
});

test("artifact traversal, duplicates, symlink escapes and oversized content are rejected", async (t) => {
  const directory = await mkdtemp(join(scratch, "evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const run = new RunEvidence({ directory });
  const context = run.startCheck("safe");
  const evidence = new CheckEvidence(context);
  for (const path of [
    "../outside",
    "..\\outside",
    "/absolute",
    "C:\\escape",
    "x/../../outside",
    "x//y",
  ])
    assert.throws(() => evidence.artifact(path, "data"), /path/i);
  evidence.artifact("proof.txt", "safe");
  assert.throws(() => evidence.artifact("proof.txt", "overwrite"), /EEXIST/);
  assert.throws(() => evidence.artifact("large.txt", "x".repeat(1024 * 1024 + 1)), /1 MiB/);
  const outside = join(directory, "outside");
  await mkdir(outside);
  await symlink(outside, join(context.directory, "artifacts", "escape"), "junction");
  assert.throws(() => evidence.artifact("escape/no.txt", "unsafe"), /symbolic/);
  assert.deepEqual(await readdir(outside), []);
});

test("truncation is explicit and an unfinished stream is never marked complete", async (t) => {
  const directory = await mkdtemp(join(scratch, "evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const run = new RunEvidence({ directory });
  const context = run.startCheck("unfinished");
  const business = new CheckEvidence(context);
  for (let index = 0; index < 200; index++)
    business.fact("observation", { text: "x".repeat(8192) });
  const entries = await events(context.directory);
  assert.equal(entries.at(-1)?.event, "evidence.truncated");
  assert.equal(
    entries.some(({ event }) => event === "business.finished"),
    false,
  );
  assert.equal(
    (await events(run.directory)).some(({ event }) => event === "run.finished"),
    false,
  );
});

test("execution errors, cancellation and persistence failures are not business success", async (t) => {
  const directory = await mkdtemp(join(scratch, "evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const run = new RunEvidence({ directory });
  const faulty = createProcessCheckProbe({
    command: process.execPath,
    args: ["-e", "process.stdout.write('invalid')"],
    evidence: run,
  });
  const result = await faulty({}, signal);
  assert.equal(result.payload, null);
  assert.match(result.message, /process-protocol/);
  const controller = new AbortController();
  const pending = createProcessCheckProbe({
    command: process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"],
    evidence: run,
  })({}, controller.signal);
  controller.abort(new Error("cancelled-by-test"));
  await assert.rejects(pending, /cancelled-by-test/);
  assert.ok((await events(run.directory)).some(({ event }) => event === "check.interrupted"));
  const blocked = join(directory, "file");
  await writeFile(blocked, "");
  assert.throws(() => new RunEvidence({ directory: blocked }), /ENOTDIR|EEXIST/);
  await rm(join(run.directory, "events.jsonl"));
  await mkdir(join(run.directory, "events.jsonl"));
  await assert.rejects(faulty({}, signal), /EISDIR|EPERM|EACCES/);
});

test("subjects and inherited credentials are not stored; explicit disable does not write", async (t) => {
  const directory = await mkdtemp(join(scratch, "evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const run = new RunEvidence({ directory });
  const probe = createMemoryCheckProbe(() => ({ ...passed, message: "echo: my-unique-password" }), {
    evidence: run,
  });
  await probe({ password: "my-unique-password", privateSubject: "must-not-store" }, signal);
  const text = await readFile(join(run.directory, "events.jsonl"), "utf8");
  assert.doesNotMatch(text, /my-unique-password|must-not-store/);
  const disabled = join(directory, "disabled");
  await withCheckEvidence(
    "disabled",
    async (evidence) => {
      assert.equal(evidence, undefined);
      return passed;
    },
    { directory: disabled, enabled: false },
  );
  await assert.rejects(readdir(disabled), { code: "ENOENT" });
});
