import fs from "node:fs";
import { randomUUID } from "node:crypto";
import promises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const parameters = new URL(import.meta.url).searchParams;
const report = parameters.get("report");
const root = parameters.get("root");
if (!report || !root) throw new Error("Probe counter requires report and root.");
const started = performance.now();
const empty = () => ({
  readdir: 0,
  lstat: 0,
  readFile: 0,
  inventory: 0,
  realpath: 0,
  open: 0,
  fstat: 0,
  fileHandleReadFile: 0,
  readBytes: 0,
});
export const counts = empty();
export const targetCounts = empty();
let firstInventoryMs;
function classification(file) {
  const absolute = resolve(file instanceof URL ? fileURLToPath(file) : String(file));
  if (absolute === report || absolute.startsWith(`${report}\\`)) return "diagnostic";
  return absolute === root || absolute.startsWith(`${root}\\`) ? "target" : "other";
}
function increment(name, kind, amount = 1) {
  if (kind === "diagnostic") return;
  counts[name] += amount;
  if (kind === "target") targetCounts[name] += amount;
}
for (const name of ["readdir", "lstat", "readFile", "realpath", "open"]) {
  const original = promises[name];
  promises[name] = function (file, ...args) {
    const kind = classification(file);
    increment(name, kind);
    if (name === "readdir" && resolve(String(file)) === root) {
      increment("inventory", kind);
      firstInventoryMs ??= performance.now() - started;
    }
    const pending = original.call(this, file, ...args);
    if (name === "readFile")
      return pending.then((content) => {
        increment("readBytes", kind, Buffer.byteLength(content));
        return content;
      });
    if (name === "open")
      return pending.then((handle) => {
        const readFile = handle.readFile;
        const stat = handle.stat;
        handle.readFile = function (...readArgs) {
          increment("fileHandleReadFile", kind);
          return readFile.apply(this, readArgs).then((content) => {
            increment("readBytes", kind, Buffer.byteLength(content));
            return content;
          });
        };
        handle.stat = function (...statArgs) {
          increment("fstat", kind);
          return stat.apply(this, statArgs);
        };
        return handle;
      });
    return pending;
  };
}
syncBuiltinESMExports();
process.once("exit", () => {
  fs.writeFileSync(`${report}\\${process.pid}-${randomUUID()}.json`, JSON.stringify({
    pid: process.pid,
    role: parameters.get("role") ?? "check",
    elapsedMs: performance.now() - started,
    firstInventoryMs,
    counts,
    targetCounts,
  }));
});
