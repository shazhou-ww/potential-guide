import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { resolveBundleSchemas, taskLogSchemaUri } from "@potential-guide/task-protocol";
import { buildTaskBundle } from "../src/build.js";

for (const mode of ["timeout", "cancel", "unawaited", "host-invalid"]) {
  test(`SDK diagnostic ${mode} is bounded and independent from required output queue`, async () => {
    const directory = resolve(".cache", `sdk-logs-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    const declaration = {
      $schema: taskLogSchemaUri,
      name: "SDK log boundary",
      runtime: { type: "node" as const, minVersion: "22.13.0" },
      entry: "worker.cjs" as const,
      inputSchema: { type: "object" },
      resultSchema: true,
      messageSchema: false,
    };
    await writeFile(join(directory, "task.yaml"), JSON.stringify(declaration));
    await writeFile(
      join(directory, "callback.ts"),
      `
export default async (_input, context) => {
  const operation=context.log({level:"info",message:"diagnostic"});
  if(${JSON.stringify(mode)}==="unawaited") { void operation; await context.progress({stage:"execution",message:"required"}); return {ok:true}; }
  try { const receipt=await operation; await context.progress({stage:"execution",message:"required"}); return receipt; }
  catch(error) { return {code:error.code}; }
}`,
    );
    let worker: Worker | undefined;
    try {
      const built = await buildTaskBundle({
        declaration: join(directory, "task.yaml"),
        entry: join(directory, "callback.ts"),
        outDirectory: join(directory, "bundle"),
      });
      const generation = randomUUID();
      worker = new Worker(join(built.directory, "worker.cjs"), {
        execArgv: [],
        workerData: {
          generation,
          maxInFlight: 1,
          maxPayloadBytes: 65_536,
          bundle: {
            digest: built.digest,
            declaration: resolveBundleSchemas(built.declaration, []),
          },
        },
      });
      let value: unknown;
      let progress = 0;
      let logAt = 0;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("SDK log boundary stalled.")), 10_000);
        worker!.on("error", reject);
        worker!.on("message", (message) => {
          if (message.kind === "ready")
            worker!.postMessage({ generation, kind: "run", runId: "run", scope: "a", input: {} });
          else if (message.kind === "log") {
            logAt = performance.now();
            if (mode === "cancel")
              worker!.postMessage({ generation, runId: "run", kind: "cancel" });
            if (mode === "host-invalid")
              worker!.postMessage({
                generation,
                runId: "run",
                kind: "log-ack",
                logId: message.logId,
                error: { code: "invalid_log", message: "host validation rejected" },
              });
          } else if (message.id !== undefined) {
            if (message.kind === "progress") progress++;
            if (message.kind === "complete") value = message.value;
            if (message.kind === "failed") {
              clearTimeout(timer);
              reject(Error(JSON.stringify(message.value)));
              return;
            }
            worker!.postMessage({ generation, kind: "ack", id: message.id });
          } else if (message.kind === "released") {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      if (mode === "timeout") {
        assert.deepEqual(value, { state: "unavailable", reason: "timeout" });
        assert.ok(performance.now() - logAt < 2500);
      } else if (mode === "cancel") {
        assert.deepEqual(value, { state: "unavailable", reason: "channel" });
        assert.ok(performance.now() - logAt < 1500);
      } else if (mode === "unawaited") {
        assert.deepEqual(value, { ok: true });
        assert.ok(performance.now() - logAt < 1500);
      } else assert.deepEqual(value, { code: "invalid_log" });
      if (mode !== "host-invalid")
        assert.equal(progress, 1, "A pending diagnostic never occupies the required output queue.");
    } finally {
      await worker?.terminate();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
