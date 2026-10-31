export function createType(configuration) {
  return {
    type: "isolated",
    version: "1",
    inputSchema: { type: "object" },
    resultSchema: true,
    messageSchema: configuration.messageSchema,
    async run(input, context) {
      if (input.kind === "block") {
        while (true) {}
      }
      if (input.kind === "message") {
        for await (const message of context.messages) {
          await message.accept();
          return {
            messageId: message.messageId,
            taskId: message.taskId,
            caller: message.caller,
            payload: message.payload,
          };
        }
      }
      if (input.kind === "wait") {
        await context.progress({ stage: "preparation", message: context.runId });
        await new Promise((resolve) => {
          if (context.signal.aborted) resolve();
          else context.signal.addEventListener("abort", resolve, { once: true });
        });
        return { runId: context.runId, scope: context.scope, canceled: true };
      }
      await context.progress({ stage: "preparation", percent: 100, message: context.runId });
      await context.progress({ stage: "allocation", message: context.runId });
      await context.progress({ stage: "execution", percent: 0, message: context.runId });
      return { input, runId: context.runId, scope: context.scope };
    },
  };
}
