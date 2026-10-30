import { createTaskEngine } from "@potential-guide/task-engine";
import { VirtualClock } from "@potential-guide/task-engine/testing";
import { at, canonical, json } from "@potential-guide/task-protocol";
import { openSqliteStore } from "../dist/index.js";

const [filename, mode, requestId] = process.argv.slice(2);
const clock = new VirtualClock();
let armed = false;
let taskId;
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
  validate: json,
  equals: (a, b) => canonical(a) === canonical(json(b)),
  prepare: async (input) => input,
  validatePrepared: json,
  validateResult: json,
  validateProgress: json,
  async execute(_input, options) {
    armed = mode.startsWith("startup-");
    const permit = options.start();
    if (mode.startsWith("terminate-")) {
      engine.submit(
        {
          requestId: requestId.slice(0, -1) + (requestId.endsWith("0") ? "1" : "0"),
          type: "echo",
          text: "crash",
          timeoutMs: 1000,
          executionMatch: "terminated-after-eligible",
        },
        { scope: "a", subject: "tester" },
      );
      armed = true;
      if (mode.includes("-failed-")) permit.fail({ code: "business", message: "Durable failure" });
      else permit.complete({ text: "durable final" });
    }
    if (mode === "completed") permit.complete({ text: "durable final" });
    process.send?.({ taskId, executionId: permit.executionId });
    process.exit(17);
  },
};
const engine = createTaskEngine({
  store,
  clock,
  types: [type],
  currentVersions: { echo: "1" },
  authorize: () => true,
});
engine.start();
if (mode === "owner") {
  process.send?.({ owned: true });
  setInterval(() => {}, 1000);
} else {
  armed = mode.startsWith("submit-");
  const raw = {
    requestId,
    type: "echo",
    text: "crash",
    timeoutMs: 1000,
    ...(mode === "future" ? { eligibleAt: at(clock.now() + 100) } : {}),
    ...(mode.startsWith("successor-") ? { recurrence: { anchor: "eligible", periodMs: 100 } } : {}),
  };
  const task = engine.submit(raw, { scope: "a", subject: "tester" });
  taskId = task.taskId;
  if (mode === "future") {
    process.send?.({ taskId });
    process.exit(17);
  }
  armed = mode.startsWith("successor-");
  clock.advance(1);
  engine.tick();
  for (let index = 0; index < 30; index++) await Promise.resolve();
  engine.tick();
}
