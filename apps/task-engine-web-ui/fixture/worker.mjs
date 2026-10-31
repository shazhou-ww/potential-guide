export function createUiType(configuration) {
  const waiting = [];
  let occupied = 0;
  const acquire = (signal) =>
    new Promise((resolve, reject) => {
      const enter = () => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        occupied++;
        resolve(() => {
          occupied--;
          waiting.shift()?.();
        });
      };
      if (occupied < configuration.capacity) enter();
      else waiting.push(enter);
    });
  return {
    type: configuration.type,
    version: "1",
    inputSchema: configuration.inputSchema,
    resultSchema: true,
    messageSchema: false,
    async run(input, context) {
      await context.progress({ stage: "preparation", message: "准备独立模拟执行。" });
      await context.progress({ stage: "allocation", message: "分配模拟资源。" });
      const release = await acquire(context.signal);
      try {
        const end = Date.now() + (input.durationMs ?? 1000);
        while (Date.now() < end) {
          context.signal.throwIfAborted();
          await context.progress({ stage: "execution", message: "独立模拟执行，不访问用户资源。" });
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(100, Math.max(1, end - Date.now()))),
          );
        }
        return { ok: false, value: input, note: "这是正常业务否定结果，不是执行故障" };
      } finally {
        release();
      }
    },
  };
}
