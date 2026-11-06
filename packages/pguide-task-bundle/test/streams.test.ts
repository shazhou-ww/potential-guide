import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { resolveBundleSchemas, taskSchemaUri } from "@potential-guide/task-protocol";
import { buildTaskBundle } from "../src/build.js";

for (const mode of ["creation", "midstream", "cancel", "abort"]) {
  test(`Bundle ReadableStream ${mode}: demand-only IPC, cancellation and errors are explicit`, async () => {
    const directory = resolve(".cache", `stream-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    let worker: Worker | undefined;
    try {
      const declaration = join(directory, "task.yaml"),
        entry = join(directory, "callback.mjs");
      await writeFile(
        declaration,
        JSON.stringify({
          $schema: taskSchemaUri,
          name: "Stream protocol proof",
          runtime: { type: "node", minVersion: "22.13.0" },
          entry: "worker.cjs",
          binary: [],
          inputSchema: { type: "object" },
          resultSchema: true,
          messageSchema: false,
        }),
      );
      await writeFile(
        entry,
        `export default async (input,context)=>{
        const controller=new AbortController();
        const stream=context.bundle.read("resources/test",{signal:controller.signal});
        if(!(stream instanceof ReadableStream))throw Error("Not a standard stream.");
        await new Promise(resolve=>setTimeout(resolve,20));
        await context.progress({stage:"execution",message:"before demand"});
        const reader=stream.getReader();
        const first=await reader.read();
        if(first.done||first.value.length!==2)throw Error("First chunk invalid.");
        await new Promise(resolve=>setTimeout(resolve,20));
        await context.progress({stage:"execution",message:"paused"});
        if(input.mode==="cancel"){await reader.cancel();return true;}
        if(input.mode==="abort"){controller.abort();try{await reader.read()}catch{return true;}throw Error("Abort ignored.");}
        await reader.read();
        throw Error("Truncated stream silently succeeded.");
      };`,
      );
      const built = await buildTaskBundle({
        declaration,
        entry,
        outDirectory: join(directory, "bundle"),
      });
      const source = await readFile(join(built.directory, "worker.cjs"), "utf8");
      await rm(entry);
      await rm(built.directory, { recursive: true });
      const generation = randomUUID();
      worker = new Worker(source, {
        eval: true,
        execArgv: [],
        workerData: {
          generation,
          maxInFlight: 4,
          maxPayloadBytes: 65_536,
          bundle: { cid: built.cid, declaration: resolveBundleSchemas(built.declaration, []) },
        },
      });
      let pulls = 0,
        cancels = 0,
        terminal = "";
      await new Promise<void>((done, reject) => {
        const timer = setTimeout(() => reject(new Error("Stream fixture timed out.")), 10_000);
        worker!.once("error", reject);
        worker!.on("message", (message) => {
          try {
            if (message.kind === "ready")
              worker!.postMessage({
                generation,
                kind: "run",
                runId: "stream",
                scope: "scope",
                input: { mode },
              });
            else if (message.kind === "bundle-pull") {
              pulls++;
              worker!.postMessage({
                generation,
                kind: "bundle-data",
                readId: message.readId,
                ...(mode === "creation" || pulls === 2
                  ? { error: { code: "read_broken", message: "Controlled read failure." } }
                  : { done: false, chunk: new Uint8Array([1, 2]) }),
              });
            } else if (message.kind === "bundle-cancel") cancels++;
            else if (message.id !== undefined) {
              if (message.kind === "progress")
                assert.equal(pulls, message.value.message === "before demand" ? 0 : 1);
              if (message.kind === "failed") {
                terminal = "failed";
                assert.equal(message.value.code, "read_broken");
              }
              if (message.kind === "complete") {
                terminal = "complete";
                assert.equal(message.value, true);
              }
              worker!.postMessage({ generation, kind: "ack", id: message.id });
            } else if (message.kind === "released") {
              clearTimeout(timer);
              done();
            }
          } catch (error) {
            clearTimeout(timer);
            reject(error);
          }
        });
      });
      assert.equal(terminal, ["cancel", "abort"].includes(mode) ? "complete" : "failed");
      assert.equal(pulls, mode === "midstream" ? 2 : 1);
      assert.ok(cancels >= 1);
    } finally {
      await worker?.terminate();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
