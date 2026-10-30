const fs = require("node:fs");
const cp = require("node:child_process");
const { threadId } = require("node:worker_threads");
let last;
exports.execute = async (subject, context) => {
  last = subject;
  fs.appendFileSync(subject.journal, `${JSON.stringify({ event: "execute", name: subject.name, pid: process.pid, threadId, revision: "original" })}\n`);
  context.progress({ pid: process.pid, threadId });
  if (subject.mode === "spin") while (true) {}
  if (subject.mode === "shared") {
    while (!fs.existsSync(subject.release)) await new Promise((done) => setTimeout(done, 10));
  }
  if (subject.mode === "error") throw Error("Expected independent invocation failure.");
  if (subject.mode === "invalid-result")
    return { status: 200, message: "", payload: { ok: false, problems: [{ kind: "internal", id: "undeclared", parameters: {} }] } };
  if (subject.mode === "cleanup-error") context.defer(() => { throw Error("Expected deferred cleanup failure."); });
  if (subject.mode === "child") {
    const child = cp.spawn(process.execPath, ["-e", `require("node:fs").writeFileSync(${JSON.stringify(subject.childFile)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000)`], { stdio: "ignore" });
    context.progress({ childPid: child.pid, threadId });
    while (!fs.existsSync(subject.childFile)) await new Promise((done) => setTimeout(done, 10));
  }
  return { status: 200, message: "", payload: { ok: false, problems: [{ kind: "internal", id: "bad", parameters: { revision: "original" } }] } };
};
exports.dispose = () => {
  if (last) fs.appendFileSync(last.journal, `${JSON.stringify({ event: "dispose", name: last.name, pid: process.pid, threadId })}\n`);
};
