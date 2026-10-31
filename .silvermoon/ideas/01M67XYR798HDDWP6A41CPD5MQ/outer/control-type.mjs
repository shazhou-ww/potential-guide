export function createControl() {
  return {
    type: "control", version: "1",
    inputSchema: { type: "object", properties: { label: { type: "string" } }, required: ["label"], additionalProperties: false },
    resultSchema: true,
    messageSchema: { type: "object", properties: { kind: { enum: ["add", "target", "finish"] }, amount: { type: "integer", minimum: 1 } }, required: ["kind"], additionalProperties: false },
    async run(input, context) {
      await context.progress({ stage: "execution", message: "等待业务消息。" });
      const contributions = [];
      let acceptedAdds = 0;
      for await (const message of context.messages) {
        if (message.payload.kind === "target") {
          await message.reject("目标修订需要新 Task，不覆盖共享需求。");
          continue;
        }
        await message.accept();
        if (message.payload.kind === "add") {
          acceptedAdds++;
          contributions.push({ amount: message.payload.amount, signal: message.signal });
        } else return {
          label: input.label, acceptedAdds,
          total: contributions.reduce((total, item) => total + (item.signal.aborted ? 0 : item.amount), 0),
        };
      }
      return { label: input.label, canceled: true };
    },
  };
}
