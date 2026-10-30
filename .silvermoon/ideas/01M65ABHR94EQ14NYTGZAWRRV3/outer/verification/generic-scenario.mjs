import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { proof, launch, bounded, request, submit, waitTask, history, stream, graceful, stopCli, cleanup } from "./helpers.mjs";
try {
  for (const cli of [false, true]) {
    const process = launch("generic-config.mjs", { cli, DATABASE: resolve(cli ? "cli.sqlite" : "programmatic.sqlite") });
    await bounded(process.ready);
    assert.equal((await request(process.url, "/tasks/unknown", { token: null })).status, 401);
    const admitted = await submit(process.url, { type: "echo", text: "independent", timeoutMs: 30000 });
    const final = await waitTask(process.url, admitted.task.taskId, "completed");
    assert.deepEqual(final.result, { text: "independent" });
    const events = await history(process.url, final.taskId);
    const subscription = await stream(process.url, final.taskId);
    const frame = await subscription.frame();
    await subscription.close();
    const resumed = await stream(process.url, final.taskId, frame.cursor);
    await resumed.frame();
    proof.cases.push({ case: cli ? "generic-cli" : "generic-programmatic", task: final, sequences: events.map((event) => event.sequence), resumedCursor: frame.cursor });
    if (cli) { await resumed.close(); await stopCli(process); }
    else { await graceful(process); await resumed.ended(); }
  }
  const started = performance.now();
  const fatal = launch("fatal-config.mjs", { cli: true });
  const outcome = await bounded(fatal.closed, 3000);
  const elapsedMs = performance.now() - started;
  assert.deepEqual(outcome, { code: 1, signal: null });
  assert.match(fatal.stderr, /Startup failed; physical cleanup unconfirmed/);
  assert.match(fatal.stderr, /startup and rollback failed/);
  assert.match(fatal.stderr, /not confirmed in time/);
  assert.doesNotMatch(fatal.stdout, /"event"\s*:\s*"(ready|closed)"/);
  proof.cases.push({ case: "cli-fatal-startup", elapsedMs, ...outcome, ready: false, closed: false, harnessKill: false, stderr: fatal.stderr });
  proof.status = "passed";
} catch (error) {
  proof.status = "failed";
  proof.error = String(error.stack ?? error);
  throw error;
} finally {
  await cleanup();
  await writeFile("result.json", `${JSON.stringify(proof, null, 2)}\n`);
}
