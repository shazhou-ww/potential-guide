const fs = require("node:fs");
const cp = require("node:child_process");
const { threadId } = require("node:worker_threads");
const role = "__ROLE__";
exports.execute = async (subject, context) => {
  fs.appendFileSync(subject.journal, `${JSON.stringify({
    at: new Date().toISOString(), event: "execute", name: subject.name, role,
    pid: process.pid, threadId, recheck: Boolean(context.data.resolutions), revision: "original",
  })}\n`);
  context.progress({ role, threadId });
  if (subject.delayMs) await new Promise((done) => setTimeout(done, subject.delayMs));
  if (role === "control") {
    if (subject.mode === "spin") while (true) {}
    if (subject.mode === "child") {
      const script = `require("node:fs").writeFileSync(${JSON.stringify(subject.childFile)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000)`;
      const child = cp.spawn(process.execPath, ["-e", script], { stdio: "ignore" });
      fs.appendFileSync(subject.childRegistry, `${JSON.stringify({
        at: new Date().toISOString(), event: "spawn", kind: "checker-child",
        pid: child.pid, ownerPid: process.pid, name: subject.name,
        command: [process.execPath, "-e", script],
      })}\n`);
      context.progress({ childPid: child.pid, threadId });
    }
    if (["hold", "child"].includes(subject.mode))
      while (!fs.existsSync(subject.release)) await new Promise((done) => setTimeout(done, 10));
  }
  if (role === "dynamic") {
    if (context.data.resolutions) return { status: 200, message: "", payload: context.data.resolutions[0].result };
    return { status: 200, message: "", payload: {
      ok: false, problems: [], requirements: [{
        objective: { kind: "objective", url: "https://probe-deployment.invalid/dependency.tgz" },
        subject, expectedLevelId: "ready",
      }],
    } };
  }
  const gap = role === "gap" || (role === "leaf" && subject.dependencyGap);
  return { status: 200, message: "", payload: {
    ok: !gap,
    problems: gap ? [{ kind: "internal", id: "bad", parameters: { role, revision: "original" } }] : [],
  } };
};
