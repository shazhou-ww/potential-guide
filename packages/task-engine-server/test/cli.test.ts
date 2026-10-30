import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

for (const mode of ["rollback-timeout", "rollback-error", "import", "factory"]) {
  test(`CLI ${mode} failure exits nonzero despite retained handles without claiming readiness or cleanup`, async () => {
    const started = performance.now();
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("../dist/main.js", import.meta.url)),
        "--config",
        fileURLToPath(new URL("./startup-failure-config.mjs", import.meta.url)),
      ],
      {
        env: { ...process.env, STARTUP_FAILURE_MODE: mode },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let killedForTimeout = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          killedForTimeout = true;
          child.kill("SIGKILL");
        }, 3000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("close", (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal });
        });
      },
    );
    assert.equal(killedForTimeout, false, `CLI required test-harness termination: ${stderr}`);
    assert.equal(outcome.signal, null);
    assert.equal(outcome.code, 1);
    assert.ok(performance.now() - started < 3000, "CLI failure exceeded the process-exit bound.");
    assert.match(stderr, /Startup failed; physical cleanup unconfirmed/);
    if (mode.startsWith("rollback")) assert.match(stderr, /startup and rollback failed/);
    if (mode === "rollback-timeout") assert.match(stderr, /not confirmed in time/);
    if (mode === "rollback-error") assert.match(stderr, /Composition rollback rejected/);
    if (mode === "import") assert.match(stderr, /Configuration import failed/);
    if (mode === "factory") assert.match(stderr, /Configuration factory failed/);
    assert.doesNotMatch(stdout, /"event"\s*:\s*"(?:ready|closed)"/);
  });
}
