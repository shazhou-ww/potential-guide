import { createTaskEngine, newId } from "@potential-guide/task-engine";
import { MemoryStore } from "@potential-guide/task-engine/testing";

const [bundleUrl, bundleDigest, url, digest] = process.argv.slice(2);
if (!bundleUrl || !bundleDigest || !url || !digest)
  throw new Error(
    "Usage: node check-in-process.mjs <bundle-url> <bundle-digest> <checker-url> <checker-digest>",
  );
const caller = { scope: "example", subject: "example" };
const store = new MemoryStore();
const engine = createTaskEngine({
  store,
  bundleDirectory: ".task-bundle-cache",
  authorize: (who, _operation, scope) => who.scope === scope && who.subject === "example",
  limits: { maxPayloadBytes: 8 * 1024 * 1024 },
});
engine.start();
try {
  let decision = await engine.submit(
    {
      requestId: newId(),
      bundle: { url: bundleUrl, digest: bundleDigest },
      checker: { kind: "checker", url, digest },
      subject: {},
      timeoutMs: 30000,
    },
    caller,
  );
  while (decision.status === "preparing")
    decision = await engine.getRequestStatus(decision.requestId, { waitMs: 1000 }, caller);
  if (decision.status !== "accepted") throw Error(JSON.stringify(decision));
  for (;;) {
    const snapshot = engine.getTask(decision.taskId, caller);
    if (snapshot.termination || snapshot.canceledAt) {
      console.log(JSON.stringify(snapshot));
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
} finally {
  await engine.close();
  store.close();
}
