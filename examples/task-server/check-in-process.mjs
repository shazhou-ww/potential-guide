import { createIpfsGatewayClient } from "@potential-guide/task-engine";
import { createTaskEngine, newId } from "@potential-guide/task-engine";
import { MemoryStore } from "@potential-guide/task-engine/testing";
import { parseBundleReference } from "@potential-guide/task-protocol/bundle-reference";

const [bundleReference, url, digest] = process.argv.slice(2);
if (!bundleReference || !url || !digest)
  throw new Error(
    "Usage: node check-in-process.mjs <bundle-cid-or-json> <checker-url> <checker-digest>",
  );
const caller = { scope: "example", subject: "example" };
const gatewayUrl = process.env.IPFS_GATEWAY;
if (!gatewayUrl) throw new Error("Set IPFS_GATEWAY to an explicit read-only Gateway URL.");
const store = new MemoryStore();
const engine = createTaskEngine({
  store,
  ipfsClient: createIpfsGatewayClient(gatewayUrl),
  authorize: (who, _operation, scope) => who.scope === scope && who.subject === "example",
  limits: { maxPayloadBytes: 8 * 1024 * 1024 },
});
await engine.start();
try {
  let decision = await engine.submit(
    {
      requestId: newId(),
      bundle: parseBundleReference(bundleReference),
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
