export function createEcho() {
  return {
    type: "echo",
    version: "1",
    inputSchema: { type: "object" },
    resultSchema: true,
    messageSchema: false,
    async run(input, context) {
      context.signal.throwIfAborted();
      await context.progress({ stage: "execution", message: "返回输入副本。" });
      return input;
    },
  };
}
