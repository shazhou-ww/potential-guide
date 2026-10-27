import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, workerPath, writeJson } from "./fixture.mjs";

const [directory, runId, requestRef] = process.argv.slice(2);
const path = workerPath(directory, runId);
const log = (type) => appendFileSync(join(directory, "operations.jsonl"), `${JSON.stringify({
  type, runId, requestRef, pid: process.pid, at: new Date().toISOString(),
})}\n`);
const state = { runId, requestRef, pid: process.pid, status: "running" };
writeJson(path, state);
log("start");
const deadline = Date.now() + 30000;
const timer = setInterval(() => {
  const control = readJson(`${path}.command`);
  if (control === null && Date.now() < deadline) return;
  clearInterval(timer);
  const outcome = control?.outcome ?? { kind: "error", message: "验证 worker 超过存活上限。" };
  writeJson(path, { ...state, status: "ended", outcome });
  log("end");
}, 25);
