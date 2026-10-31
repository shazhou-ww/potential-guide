import { appendFile } from "node:fs/promises";
export function createFault(configuration) {
  return {
    type: "fault", version: "1", inputSchema: { type: "object" }, resultSchema: true, messageSchema: false,
    async run(input, context) {
      await appendFile(configuration.invocations, JSON.stringify({ runId: context.runId, label: input.label, pid: process.pid }) + "\n");
      await context.progress({ stage: "execution", message: "独立故障消费者已进入业务。" });
      if (input.mode === "crash") process.exit(39);
      if (input.mode === "hang") { for (;;) {} }
      if (input.mode === "wait")
        await new Promise((resolve) => {
          context.signal.addEventListener("abort", resolve, { once: true });
          if (context.signal.aborted) resolve();
        });
      return { label: input.label, runId: context.runId, canceled: context.signal.aborted };
    },
  };
}
