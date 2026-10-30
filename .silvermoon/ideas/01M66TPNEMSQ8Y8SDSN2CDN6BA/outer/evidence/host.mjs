import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createExecutorPool } from "@potential-guide/task-engine/pool";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { openSqliteStore } from "@potential-guide/task-engine-storage";
import { json, TaskError } from "@potential-guide/task-protocol";

// 仅测试子进程的墙钟由父进程 IPC 控制；真实 HTTP、计时器和单调时钟保持原样。
let now = Number(process.env.PROOF_TIME);
Date.now = () => now;
const root = await realpath(process.cwd());
const entries = {};
for (const name of [
  "task-protocol",
  "task-engine",
  "task-engine-http",
  "task-engine-storage",
  "task-engine-server",
]) {
  const entry = await realpath(fileURLToPath(import.meta.resolve(`@potential-guide/${name}`)));
  const path = relative(root, entry);
  if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`))
    throw new Error(`非隔离模块: ${entry}`);
  entries[name] = {
    path,
    sha256: createHash("sha256")
      .update(await readFile(entry))
      .digest("hex"),
  };
}
const stats = { prepares: 0, executions: 0, collects: 0, appends: 0, compacts: 0 };
const work = new Map();
const pool = createExecutorPool({
  resources: Array(12).fill("history-proof"),
  resourceKey: () => "history-proof",
  run(input, permit) {
    stats.executions++;
    let finish;
    let exited;
    const result = new Promise((resolve) => {
      finish = resolve;
    });
    const exit = new Promise((resolve) => {
      exited = resolve;
    });
    const end = () => {
      finish(input);
      exited();
    };
    work.set(permit.executionId, { permit, end });
    return {
      result,
      exited: exit,
      cooperate: end,
      async force() {
        end();
      },
      async cleanup() {
        work.delete(permit.executionId);
      },
    };
  },
});
const inputSchema = {
  type: "object",
  properties: {
    text: { type: "string" },
    amount: { type: "number" },
    metadata: { type: "object" },
  },
  required: ["text", "amount", "metadata"],
  additionalProperties: false,
};
const echo = {
  type: "echo",
  version: "1",
  environment: "history-proof-v1",
  inputSchema,
  async prepare(input) {
    stats.prepares++;
    return input;
  },
  validatePrepared: json,
  validateResult: json,
  validateProgress: json,
  execute: (input, options) => pool.execute(input, options),
};
const store = openSqliteStore("history.sqlite");
// 仅计数公开 Store 操作，不读取或查询 SQLite 证明业务结果。
const countedStore = {
  claim: (...args) => store.claim(...args),
  release: (...args) => store.release(...args),
  read: () => store.read(),
  append(...args) {
    stats.appends++;
    return store.append(...args);
  },
  compact(...args) {
    stats.compacts++;
    return store.compact(...args);
  },
  close: () => store.close(),
};
const identities = {
  alpha: { scope: "shared", subject: "client-alpha" },
  beta: { scope: "shared", subject: "client-beta" },
  other: { scope: "other", subject: "client-other" },
  denied: { scope: "shared", subject: "denied" },
  reader: { scope: "shared", subject: "reader" },
};
const revoked = new Set();
const server = await startTaskServer({
  host: "127.0.0.1",
  port: 0,
  store: countedStore,
  ownStore: true,
  types: [echo, { ...echo, version: "2" }, { ...echo, type: "alternate" }],
  currentVersions: { echo: process.env.PROOF_VERSION, alternate: "1" },
  limits: {
    queryLifetimeMs: 120_000,
    retentionMs: 2_000,
    executionWallMs: 600_000,
    maxQueryViews: 64,
  },
  authorize(who, operation, scope) {
    return (
      who.scope === scope &&
      who.subject !== "denied" &&
      !revoked.has(`${who.subject}:${operation}`) &&
      !(who.subject === "reader" && ["request", "submit"].includes(operation))
    );
  },
  resolveCaller(request) {
    const who = identities[request.headers.get("x-proof-client")];
    if (!who) throw new TaskError("unauthenticated", "需要测试身份");
    return who;
  },
  closeResources: () => pool.close(),
});
let closed = false;
async function close() {
  if (closed) return;
  closed = true;
  await server.close();
}
process.on("disconnect", () => {
  close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
});
process.on("message", async ({ id, command, value }) => {
  try {
    let result;
    if (command === "time") {
      now = value;
      result = now;
    } else if (command === "stats") {
      result = { ...stats, active: work.size };
    } else if (command === "progress") {
      const item = work.get(value.executionId);
      if (!item) throw new Error("测试执行器不存在");
      item.permit.progress(value.progress);
      result = true;
    } else if (command === "finish") {
      for (const item of work.values()) item.end();
      result = true;
    } else if (command === "revoke") {
      const key = `${identities[value.client].subject}:${value.operation}`;
      if (value.denied) revoked.add(key);
      else revoked.delete(key);
      result = true;
    } else if (command === "collect") {
      stats.collects++;
      server.engine.collect();
      result = { ...stats };
    } else if (command === "close") {
      await close();
      process.send({ id, result: { closed: true } }, () => process.disconnect());
      return;
    } else {
      throw new Error("未知测试控制指令");
    }
    process.send({ id, result });
  } catch (error) {
    process.send({ id, error: { message: error.message, code: error.code } });
  }
});
process.send({ ready: true, pid: process.pid, url: server.url, entries });
