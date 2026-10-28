const fs = require("node:fs");
const path = require("node:path");
const { threadId } = require("node:worker_threads");
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "resources", "control.json"), "utf8"));
let invocation = 0;
const record = value => fs.appendFileSync(path.join(config.control, "worker.jsonl"),
  `${JSON.stringify({ version: config.version, worker: threadId, at: Date.now(), ...value })}\n`);
const gate = name => path.join(config.control, `gate-${name}`);
exports.initialize = async () => {
  record({ type: "initialize" });
  if (!fs.existsSync(gate("initialize")))
    await new Promise(resolve => {
      const timer = setInterval(() => {
        if (fs.existsSync(gate("initialize"))) { clearInterval(timer); resolve(); }
      }, 5);
    });
};
exports.execute = async (subject, context) => {
  const number = ++invocation;
  let child;
  if (subject.spawn) child = require("node:child_process").spawn(
    process.execPath, ["-e", "setInterval(()=>{},1000)"],
    { stdio: "ignore", detached: process.platform !== "win32" },
  );
  record({ type: "entered", name: subject.name, invocation: number, child: child?.pid });
  context.defer(() => record({ type: "cleaned", name: subject.name, invocation: number,
    aborted: context.signal.aborted }));
  if (subject.spin) while (true) {}
  if (subject.gate && !fs.existsSync(gate(subject.gate))) {
    await new Promise(resolve => {
      const finish = () => { clearInterval(timer); resolve(); };
      const timer = setInterval(() => { if (fs.existsSync(gate(subject.gate))) finish(); }, 5);
      context.signal.addEventListener("abort", finish, { once: true });
      context.defer(() => { clearInterval(timer); context.signal.removeEventListener("abort", finish); });
      if (context.signal.aborted) finish();
    });
  }
  return { ok: !subject.fail, version: config.version, worker: threadId, invocation: number };
};
