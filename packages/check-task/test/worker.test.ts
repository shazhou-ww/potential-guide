import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { checkerSchemaUri, inspectContractFiles } from "@potential-guide/check-artifacts/contracts";
import { runChecker } from "../src/worker.js";

test("forced cleanup reaps owned children before terminating their spawning Worker", async (t) => {
  const directory = resolve(".cache", `checker-reaping-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const artifact = inspectContractFiles(
    new Map([
      [
        "checker.yaml",
        Buffer.from(
          JSON.stringify({
            $schema: checkerSchemaUri,
            runtime: { type: "node", minVersion: "22.13.0" },
            entry: "checker.cjs",
            subjectSchema: { type: "object" },
            problems: [],
            languages: ["en"],
          }),
        ),
      ],
      [
        "checker.cjs",
        Buffer.from(
          "exports.execute=(s,c)=>{const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});c.progress(child.pid);return {status:200,message:'',payload:{ok:true,problems:[]}}}",
        ),
      ],
      [
        "references/en/checker.md",
        Buffer.from("---\ntitle: Check\ndescription: Check\n---\nBody\n"),
      ],
    ]),
  );
  assert.ok("entry" in artifact.manifest);
  let pid: number | undefined;
  let reapedBeforeTermination = false;
  const terminate = Worker.prototype.terminate;
  t.mock.method(Worker.prototype, "terminate", function (this: Worker) {
    assert.ok(pid);
    try {
      process.kill(pid, 0);
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
      reapedBeforeTermination = true;
    }
    return terminate.call(this);
  });
  const checker = {
    kind: "checker" as const,
    url: "https://example.test/checker.tgz",
    digest: artifact.digest,
  };
  const work = runChecker(
    {
      input: { checker, subject: {} },
      checker,
      files: Object.fromEntries(
        [...artifact.files].map(([path, bytes]) => [path, bytes.toString("base64")]),
      ),
      language: "en",
      environment: "test",
      workerRevision: "test",
    },
    { ...artifact, manifest: artifact.manifest },
    {
      runId: randomUUID(),
      generation: randomUUID(),
      startedAt: new Date().toISOString(),
      progress(value) {
        assert.ok(typeof value === "number");
        pid = value;
      },
      complete() {},
      fail() {},
    },
    { directory, wallMs: 10_000, cleanupMs: 5_000, memoryMb: 128, environment: {} },
  );
  try {
    await assert.rejects(work.result, /Checker cleanup failed/);
    await work.exited;
    assert.equal(reapedBeforeTermination, true);
  } finally {
    await work.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});
