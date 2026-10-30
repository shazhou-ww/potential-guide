const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const threads = require("node:worker_threads");
const cp = require("node:child_process");
const { basename } = require("node:path");
const Original = threads.Worker;
const path = process.env.WORKER_PROOF;
const spawn = cp.spawn;
cp.spawn = function (...args) {
  const child = Reflect.apply(spawn, this, args);
  if (basename(String(args[0])).toLowerCase() === "powershell.exe") {
    const report = (event, extra = {}) => fs.appendFileSync(path, `${JSON.stringify({
      event, pid: process.pid, helperPid: child.pid, ...extra,
    })}\n`);
    report("file-helper-start");
    child.once("close", (code, signal) => report("file-helper-exit", { code, signal }));
  }
  return child;
};
threads.Worker = class ObservedWorker extends Original {
  constructor(...args) {
    super(...args);
    const threadId = this.threadId;
    const report = (event, extra = {}) => fs.appendFileSync(path, `${JSON.stringify({
      event, pid: process.pid, threadId, ...extra,
    })}\n`);
    const previous = process.env.OWNED_CHILD_PROOF;
    let child = {};
    if (previous && fs.existsSync(previous)) {
      const { pid } = JSON.parse(fs.readFileSync(previous, "utf8"));
      let exists = true;
      try { process.kill(pid, 0); }
      catch (error) {
        if (error.code !== "ESRCH") throw error;
        exists = false;
      }
      child = { previousOwnedPid: pid, previousOwnedAlive: exists };
    }
    report("worker-start", child);
    this.once("exit", (code) => report("worker-exit", { code }));
  }
};
syncBuiltinESMExports();
