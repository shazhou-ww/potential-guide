import { createTaskEngine } from "@potential-guide/task-engine";
import { VirtualClock } from "@potential-guide/task-engine/testing";
import { at, TaskError } from "@potential-guide/task-protocol";
import { openSqliteStore } from "../dist/index.js";

const [filename, mode, requestId] = process.argv.slice(2);
const clock = new VirtualClock();
let armed = false;
const store = openSqliteStore(filename, {
  fault(point) {
    if (
      armed &&
      ((mode.endsWith("before") && point === "beforeCommit") ||
        (mode.endsWith("after") && point === "afterCommit"))
    )
      process.exit(17);
  },
});
const type = {
  type: "echo",
  version: "1",
  environment: "test",
  inputSchema: { type: "object" },
  resultSchema: true,
  messageSchema: false,
  module: new URL("./crash-worker.mjs", import.meta.url).href,
  exportName: "createType",
  configuration: {},
  resources: {
    async effect() {
      if (mode.startsWith("terminate-")) {
        engine.submit(
          {
            requestId: requestId.slice(0, -1) + (requestId.endsWith("0") ? "1" : "0"),
            type: "echo",
            text: "crash",
            timeoutMs: 1000,
            matchPolicy: "terminated-after-eligible",
          },
          { scope: "a", subject: "tester" },
        );
        armed = true;
        if (mode.includes("-failed-")) throw new TaskError("business", "Durable failure");
      }
      return { text: "durable final" };
    },
  },
};
const engine = createTaskEngine({
  store,
  clock,
  types: [type],
  currentVersions: { echo: "1" },
  authorize: () => true,
});
await engine.start();
if (mode === "owner") {
  process.send?.({ owned: true });
  setInterval(() => engine.tick(), 1000);
} else {
  armed = mode.startsWith("submit-");
  const task = engine.submit(
    {
      requestId,
      type: "echo",
      text: "crash",
      timeoutMs: 1000,
      ...(mode === "future" ? { eligibleAt: at(clock.now() + 100) } : {}),
      ...(mode.startsWith("successor-")
        ? { recurrence: { anchor: "eligible", periodMs: 100 } }
        : {}),
    },
    { scope: "a", subject: "tester" },
  );
  if (mode === "future") {
    process.send?.({ taskId: task.taskId });
    process.exit(17);
  }
  armed = mode.startsWith("successor-") || mode.startsWith("startup-");
  clock.advance(1);
  engine.tick();
  if (!mode.startsWith("terminate-") && mode !== "completed") {
    process.send?.({
      taskId: task.taskId,
      runId: engine.getTask(task.taskId, { scope: "a", subject: "tester" }).run?.runId,
    });
    process.exit(17);
  }
  for (let count = 0; count < 1000; count++) {
    if (engine.getTask(task.taskId, { scope: "a", subject: "tester" }).termination) {
      process.send?.({ taskId: task.taskId });
      process.exit(17);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("终结未到达。");
}
