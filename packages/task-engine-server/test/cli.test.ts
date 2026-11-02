import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

for (const mode of ["rollback-timeout", "rollback-error", "import", "factory"]) {
  test(`CLI ${mode} failure exits nonzero despite retained handles without claiming readiness or cleanup`, async () => {
    const loadingMs = 30_000;
    const failureExitMs = 10_000;
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("../dist/main.js", import.meta.url)),
        "--config",
        fileURLToPath(new URL("./startup-failure-config.mjs", import.meta.url)),
      ],
      {
        env: { ...process.env, STARTUP_FAILURE_MODE: mode },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let killedForTimeout = false;
    let armed = false;
    let timeoutPhase = "module loading";
    assert.ok(child.stdout);
    assert.ok(child.stderr);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        const terminate = () => {
          killedForTimeout = true;
          child.kill("SIGKILL");
        };
        let timer = setTimeout(terminate, loadingMs);
        child.once("message", (message) => {
          if (
            !message ||
            typeof message !== "object" ||
            !("fixture" in message) ||
            message.fixture !== "startup-failure-armed" ||
            !("mode" in message) ||
            message.mode !== mode ||
            !("retainedHandle" in message) ||
            message.retainedHandle !== true
          ) {
            clearTimeout(timer);
            child.kill("SIGKILL");
            reject(new Error(`Invalid startup-failure handshake: ${JSON.stringify(message)}`));
            return;
          }
          armed = true;
          timeoutPhase = "failure process exit";
          clearTimeout(timer);
          timer = setTimeout(terminate, failureExitMs);
          child.send("trigger-startup-failure");
        });
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
    assert.equal(
      killedForTimeout,
      false,
      `CLI required test-harness termination during ${timeoutPhase}: ${stderr}`,
    );
    assert.equal(armed, true, "CLI never reached the retained-handle failure fixture.");
    assert.equal(outcome.signal, null);
    assert.equal(outcome.code, 1);
    assert.match(stderr, /Startup failed; physical cleanup unconfirmed/);
    if (mode.startsWith("rollback")) assert.match(stderr, /startup and rollback failed/);
    if (mode === "rollback-timeout") assert.match(stderr, /not confirmed in time/);
    if (mode === "rollback-error") assert.match(stderr, /Composition rollback rejected/);
    if (mode === "import") assert.match(stderr, /Configuration import failed/);
    if (mode === "factory") assert.match(stderr, /Configuration factory failed/);
    assert.doesNotMatch(stdout, /"event"\s*:\s*"(?:ready|closed)"/);
  });
}
