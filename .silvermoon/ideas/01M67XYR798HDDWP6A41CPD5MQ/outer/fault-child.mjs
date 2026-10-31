import { join } from "node:path";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { openSqliteStore } from "@potential-guide/task-engine-storage";
import { access, root } from "./consumer-lib.mjs";
const store = openSqliteStore(join(root, "fault.sqlite"));
let engine;
const server = await startTaskServer({
  store, port: 0, types: [{
    type: "fault", version: "1", environment: "external-fault-v1",
    inputSchema: { type: "object" }, resultSchema: true, messageSchema: false,
    module: new URL("./fault-type.mjs", import.meta.url).href, exportName: "createFault",
    configuration: { invocations: join(root, "fault-invocations.jsonl") },
  }], currentVersions: { fault: "1" }, resolveCaller: access,
  authorize: (who, _operation, scope) => who.scope === scope,
  bindService(value) { engine = value; },
});
process.on("message", (message) => {
  if (message.kind === "submit") {
    const snapshot = engine.submit(message.request, { scope: "a", subject: "fixture" });
    process.send({ kind: "submitted", id: message.id, snapshot });
  } else if (message.kind === "snapshot")
    process.send({ kind: "snapshot", id: message.id, events: store.read().events });
});
process.send({ kind: "ready", url: server.url, pid: process.pid });
