import { createTaskEngine, newId } from "@potential-guide/task-engine";
import { MemoryStore } from "@potential-guide/task-engine/testing";
import { createArtifactSource, createCheckTaskType } from "@potential-guide/check-task";

const [url, digest] = process.argv.slice(2);
if (!url || !digest)
  throw new Error("Usage: node check-in-process.mjs <trusted-https-or-file-url> <exact-digest>");
const caller = { scope: "example", subject: "example" };
const source = createArtifactSource({
  allowedOrigins: new URL(url).protocol === "https:" ? [new URL(url).origin] : [],
  allowedFileRoots: process.env.CHECK_FILE_ROOT ? [process.env.CHECK_FILE_ROOT] : [],
  authorize() {},
});
const check = createCheckTaskType({ source, directory: ".check-workers", workers: 1 });
const store = new MemoryStore();
const engine = createTaskEngine({
  store,
  types: [check],
  currentVersions: { check: "2" },
  authorize: (who, _operation, scope) => who.scope === scope && who.subject === "example",
  limits: { maxPayloadBytes: 8 * 1024 * 1024 },
});
engine.start();
try {
  const task = engine.submit(
    {
      requestId: newId(),
      type: "check",
      checker: { kind: "checker", url, digest },
      subject: {},
      timeoutMs: 30000,
    },
    caller,
  );
  for (;;) {
    const snapshot = engine.getTask(task.taskId, caller);
    if (snapshot.termination || snapshot.canceledAt) {
      console.log(JSON.stringify(snapshot));
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
} finally {
  await engine.close();
  await check.close();
  await source.close();
  store.close();
}
