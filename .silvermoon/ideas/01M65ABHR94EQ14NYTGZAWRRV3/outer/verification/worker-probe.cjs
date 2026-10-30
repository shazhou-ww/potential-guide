const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const threads = require("node:worker_threads");
const Original = threads.Worker;
const path = process.env.WORKER_PROOF;
threads.Worker = class ObservedWorker extends Original {
  constructor(...args) {
    super(...args);
    const threadId = this.threadId;
    const report = (event, extra = {}) => fs.appendFileSync(path, `${JSON.stringify({
      event, pid: process.pid, threadId, ...extra,
    })}\n`);
    report("worker-start");
    this.once("exit", (code) => report("worker-exit", { code }));
  }
};
syncBuiltinESMExports();
