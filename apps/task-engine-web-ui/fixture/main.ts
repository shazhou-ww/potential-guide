import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { MemoryStore } from "@potential-guide/task-engine/testing";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { TaskError } from "@potential-guide/task-protocol";
import { fixtureTypes } from "./types.js";

const root = resolve(process.argv[2] ?? ".cache/web-ui-demo");
await mkdir(dirname(root), { recursive: true });
await mkdir(root);
const resources = fixtureTypes();
const token = randomBytes(32).toString("hex");
const server = await startTaskServer({
  port: 0,
  store: new MemoryStore(),
  types: resources.types,
  currentVersions: { echo: "1", survey: "1" },
  authorize: (caller, operation, scope) =>
    caller.scope === scope &&
    (caller.subject !== "directory" || ["list", "list-executions"].includes(operation)),
  resolveCaller(request) {
    const bearer = request.headers.get("authorization");
    if (bearer === `Bearer ${token}`) return { scope: "demo", subject: "full" };
    if (bearer === `Bearer ${token}-list`) return { scope: "demo", subject: "directory" };
    if (bearer === `Bearer ${token}-other`) return { scope: "other", subject: "full" };
    throw new TaskError("unauthenticated", "Fixture authentication required.");
  },
  limits: { maxConcurrent: 3, pageSize: 10 },
  closeResources: resources.close,
});
const config = {
  port: 0,
  favoritesFile: resolve(root, "favorites.json"),
  endpoints: [
    {
      id: "demo",
      label: "完整权限 · demo",
      binding: "fixture-1",
      url: server.url,
      bearerEnv: "TASK_UI_DEMO_TOKEN",
    },
    {
      id: "directory",
      label: "只读目录 · demo",
      binding: "fixture-1",
      url: server.url,
      bearerEnv: "TASK_UI_LIST_TOKEN",
    },
    {
      id: "other",
      label: "独立 scope · other",
      binding: "fixture-1",
      url: server.url,
      bearerEnv: "TASK_UI_OTHER_TOKEN",
    },
  ],
};
try {
  await writeFile(resolve(root, "ui.json"), JSON.stringify(config, null, 2), { flag: "wx" });
  await writeFile(
    resolve(root, "credentials.json"),
    JSON.stringify({
      TASK_UI_DEMO_TOKEN: token,
      TASK_UI_LIST_TOKEN: `${token}-list`,
      TASK_UI_OTHER_TOKEN: `${token}-other`,
    }),
    { mode: 0o600, flag: "wx" },
  );
} catch (error) {
  await server.close();
  throw error;
}
console.log(`隔离 Task Server：${server.url}`);
console.log(`UI 配置：${resolve(root, "ui.json")}；凭据仅保存在拥有的 fixture 目录，不输出值。`);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void server.close().catch(() => {
      console.error("Fixture 关闭失败。");
      process.exitCode = 1;
    });
  });
}
