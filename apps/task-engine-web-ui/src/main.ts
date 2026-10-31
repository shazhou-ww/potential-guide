import { readFile } from "node:fs/promises";
import { startUiServer, type UiConfig } from "./server.js";

try {
  const path = process.argv[2];
  if (!path) throw new Error("用法：node dist/src/main.js <可信配置.json>");
  const config = JSON.parse(await readFile(path, "utf8")) as UiConfig;
  const server = await startUiServer(config);
  console.log(`任务工作台 ${server.url}`);
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      void server.close().catch(() => {
        console.error("UI 关闭失败。");
        process.exitCode = 1;
      });
    });
} catch (error) {
  console.error(error instanceof Error ? error.message : "启动失败。");
  process.exitCode = 1;
}
