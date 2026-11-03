import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { resolveBundleSchemas, taskLogSchemaUri } from "@potential-guide/task-protocol";
import { buildTaskBundle } from "../src/build.js";

for (const acknowledgment of ["withheld", "late"]) {
  test(`awaited diagnostic floods keep drop reporting bounded with ${acknowledgment} drop acknowledgments`, async () => {
    const directory = resolve(".cache", `drop-reporting-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    let worker: Worker | undefined;
    try {
      await writeFile(
        join(directory, "task.yaml"),
        JSON.stringify({
          $schema: taskLogSchemaUri,
          name: "Bounded drop reporting",
          runtime: { type: "node", minVersion: "22.13.0" },
          entry: "worker.cjs",
          inputSchema: { type: "object" },
          resultSchema: true,
          messageSchema: false,
        }),
      );
      await writeFile(
        join(directory, "callback.ts"),
        `
export default async (_input, context) => {
  let rejected=0;
  const pending=[];
  for(let round=0;round<2;round++) {
    for(let i=0;i<16;i++) pending.push(context.log({level:"info",message:"pending"}));
    for(let i=0;i<20000;i++) {
      const receipt=await context.log({level:"debug",message:"capacity rejection"});
      if(receipt.state!=="dropped"||receipt.reason!=="capacity") throw Error("Expected bounded rejection");
      rejected++;
    }
    await context.progress({stage:"execution",message:"round:"+round});
    if(round===0) await new Promise(resolve=>setTimeout(resolve,1100));
  }
  await Promise.all(pending);
  return {ok:true,rejected};
}`,
      );
      const bundle = await buildTaskBundle({
        declaration: join(directory, "task.yaml"),
        entry: join(directory, "callback.ts"),
        outDirectory: join(directory, "bundle"),
      });
      const generation = randomUUID();
      worker = new Worker(join(bundle.directory, "worker.cjs"), {
        execArgv: [],
        workerData: {
          generation,
          maxInFlight: 16,
          maxPayloadBytes: 65_536,
          bundle: {
            digest: bundle.digest,
            declaration: resolveBundleSchemas(bundle.declaration, []),
          },
        },
      });
      let dropFrames = 0,
        ordinaryFrames = 0,
        terminalFrames = 0,
        pendingLogs = 0;
      let dropped = 0,
        lastCount = 0,
        progress = 0;
      let firstDrop: number | undefined;
      let value: unknown;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Drop reporting blocked required outputs.")),
          15_000,
        );
        worker!.once("error", reject);
        worker!.on("message", (message) => {
          try {
            if (message.kind === "ready")
              worker!.postMessage({
                generation,
                kind: "run",
                runId: "run",
                scope: "scope",
                input: {},
              });
            else if (message.kind === "log") pendingLogs++;
            else if (message.kind === "log-drop") {
              dropFrames++;
              if (message.final) terminalFrames++;
              else ordinaryFrames++;
              assert.ok(message.count >= lastCount);
              dropped += message.count - lastCount;
              lastCount = message.count;
              if (firstDrop === undefined) firstDrop = message.logId;
              else if (acknowledgment === "late" && !message.final)
                worker!.postMessage({
                  generation,
                  runId: "run",
                  kind: "log-drop-ack",
                  logId: message.logId,
                  value: { state: "dropped", reason: "capacity" },
                });
            } else if (message.id !== undefined) {
              if (message.kind === "progress") {
                progress++;
                assert.equal(
                  ordinaryFrames,
                  1,
                  "No extra drop frame is authorized by awaited rejections or timeout.",
                );
                if (message.value.message === "round:1" && acknowledgment === "late")
                  worker!.postMessage({
                    generation,
                    runId: "run",
                    kind: "log-drop-ack",
                    logId: firstDrop,
                    value: { state: "dropped", reason: "capacity" },
                  });
              }
              if (message.kind === "complete") value = message.value;
              if (message.kind === "failed") throw Error(JSON.stringify(message.value));
              worker!.postMessage({ generation, kind: "ack", id: message.id });
            } else if (message.kind === "released") {
              clearTimeout(timer);
              resolve();
            }
          } catch (error) {
            clearTimeout(timer);
            reject(error);
          }
        });
      });
      assert.deepEqual(value, { ok: true, rejected: 40000 });
      assert.equal(pendingLogs, 32);
      assert.equal(progress, 2);
      assert.equal(
        dropped,
        40000,
        "Cumulative snapshots retain the eventual aggregate without double counting.",
      );
      assert.ok(dropFrames <= 2);
      assert.ok(terminalFrames <= 1);
      if (acknowledgment === "withheld") {
        assert.equal(ordinaryFrames, 1);
        assert.equal(terminalFrames, 1);
      }
    } finally {
      await worker?.terminate();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
