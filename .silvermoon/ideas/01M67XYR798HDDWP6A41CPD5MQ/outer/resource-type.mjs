export function createResource(_configuration, resources) {
  return {
    type: "resource", version: "1", inputSchema: { type: "object" }, resultSchema: true, messageSchema: false,
    async run(_input, context) {
      void resources.invoke(context, "hold", null).catch(() => {});
      return { ok: true, runId: context.runId };
    },
  };
}
