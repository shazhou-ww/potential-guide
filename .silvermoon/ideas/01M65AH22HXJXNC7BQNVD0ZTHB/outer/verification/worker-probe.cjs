const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const threads = require("node:worker_threads");
const Original = threads.Worker;
const trace = process.env.WORKER_PROOF;
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}
threads.Worker = class ObservedWorker extends Original {
  constructor(filename, options) {
    super(filename, options);
    const threadId = this.threadId;
    const data = options?.workerData;
    const role = data?.prepared && data?.policy ? "probe" : data?.entry && data?.generation ? "check" : "unknown";
    const report = (event, fields = {}) => fs.appendFileSync(trace, `${JSON.stringify({
      at: new Date().toISOString(), event, pid: process.pid, instance: process.env.PROOF_INSTANCE, threadId, role,
      workerFile: String(filename), executionId: data?.executionId, generation: data?.generation, ...fields,
    })}\n`);
    const owned = process.env.OWNED_PROOF && fs.existsSync(process.env.OWNED_PROOF)
      ? fs.readFileSync(process.env.OWNED_PROOF, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
      : [];
    const latest = new Map(owned.map((row) => [row.pid, row]));
    const activeChildren = [...latest.values()].filter((row) => row.event === "spawn" && row.kind === "checker-child" && alive(row.pid)).map((row) => row.pid);
    report("worker-start", { ownedChildrenAliveAtStart: activeChildren });
    this.once("exit", (code) => report("worker-exit", { code }));
    const post = this.postMessage;
    this.postMessage = function (message, ...rest) {
      if (role === "check" && message?.type === "execute")
        report("worker-execute", { executionId: message.checkId });
      return post.call(this, message, ...rest);
    };
  }
};
syncBuiltinESMExports();
