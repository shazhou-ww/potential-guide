import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openSqliteStore } from "@potential-guide/task-engine-storage";
import { emptyFacts } from "@potential-guide/task-protocol";
import { at, caller, epoch, harness, isolation, policies, recorder } from "./harness.mjs";

const [mode, kind, filename, output, receipt] = process.argv.slice(2);
const report = { mode, kind, pid: process.pid, modules: isolation() };
const r = recorder();
report.checks = r.checks;
let h;
let writer;
let crash = false;

function snapshot(directory) {
  return readdirSync(directory)
    .sort()
    .map((name) => {
      const bytes = readFileSync(join(directory, name));
      return { name, bytes };
    });
}
function hashes(files) {
  return files.map(({ name, bytes }) => ({
    name,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }));
}

try {
  if (mode === "write") {
    h = harness({ store: openSqliteStore(filename) });
    const driver = h.submit({ eligibleAt: at(epoch - 500) });
    await h.drive();
    const demand = h.submit({
      eligibleAt: at(epoch - 500),
      executionMatch: policies[1],
    });
    r.equal("one execution before crash", h.work.length, 1);
    r.equal("terminated demand has no premature binding", h.read(demand).execution, undefined);
    if (kind !== "interrupted") h.work[0].finish(kind);
    report.originals = [driver, demand].map((task) => h.engine.getRequest(task.requestId, caller));
    report.taskIds = [driver.taskId, demand.taskId];
    report.executionId = h.read(driver).execution.executionId;
    report.observed = h.evidence([driver, demand]);
    report.status = "passed";
    crash = true;
  } else if (mode === "read") {
    const original = JSON.parse(readFileSync(receipt, "utf8"));
    r.truth("reader is another process", original.pid !== process.pid);
    h = harness({ store: openSqliteStore(filename), time: epoch + 50 });
    await h.drive();
    r.equal("no automatic execution replay", h.work.length, 0);
    for (let index = 0; index < original.taskIds.length; index++) {
      const taskId = original.taskIds[index];
      const raw = original.originals[index];
      const before = original.observed.snapshots[index].snapshot;
      const current = h.read(taskId);
      r.equal(
        `task ${index} outcome`,
        current.stage,
        kind === "completed" ? "completed" : "execution_failed",
      );
      r.equal(`task ${index} original request`, h.engine.getRequest(raw.requestId, caller), raw);
      const repeated = h.engine.submit(raw, caller);
      for (const key of ["taskId", "receivedAt", "eligibleAt", "deadlineAt"])
        r.equal(`task ${index} stable ${key}`, repeated[key], before[key]);
      r.equal(
        `task ${index} execution identity`,
        current.execution.executionId,
        original.executionId,
      );
      r.equal(
        `task ${index} final time`,
        current.termination.terminatedAt,
        at(epoch + (kind === "interrupted" ? 50 : 0)),
      );
      if (kind !== "completed")
        r.equal(
          `task ${index} actual failure`,
          current.error.code,
          kind === "interrupted" ? "execution_interrupted" : "external_failure",
        );
    }
    report.observed = h.evidence(original.taskIds);
    report.status = "passed";
  } else if (mode === "format") {
    mkdirSync(dirname(filename), { recursive: true });
    if (["zero", "v1", "unknown"].includes(kind)) {
      const version = kind === "zero" ? 0 : kind === "v1" ? 1 : 99;
      writer = new DatabaseSync(filename);
      writer.exec(
        `CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('old evidence'); PRAGMA user_version=${version};`,
      );
      writer.close();
      writer = undefined;
      if (kind !== "zero") {
        writeFileSync(`${filename}-wal`, "owned old WAL sentinel");
        writeFileSync(`${filename}-shm`, "owned old SHM sentinel");
      }
    } else {
      openSqliteStore(filename).close();
      writer = new DatabaseSync(filename);
      if (kind === "checkpoint" || kind === "live-wal")
        writer.exec("UPDATE checkpoint SET projection_version=1");
      else if (kind === "facts")
        writer.prepare("UPDATE checkpoint SET payload=?").run(
          JSON.stringify({
            ...emptyFacts(),
            projectionVersion: 1,
          }),
        );
      else if (kind === "binding")
        writer.prepare("UPDATE checkpoint SET payload=?").run(
          JSON.stringify({
            ...emptyFacts(),
            executions: { old: { binding: { executionMatch: "completed-after-eligible" } } },
          }),
        );
      else throw new Error(`Unknown owned fixture: ${kind}`);
      if (kind !== "live-wal") {
        writer.close();
        writer = undefined;
      }
    }
    writeFileSync(`${filename}.owner`, "owned legacy owner sentinel");
    const before = snapshot(dirname(filename));
    if (kind === "live-wal")
      r.truth(
        "fixture has a real live WAL and SHM",
        before.some((file) => file.name.endsWith("-wal")) &&
          before.some((file) => file.name.endsWith("-shm")),
      );
    r.error("old format rejected", () => openSqliteStore(filename), "unsupported_version");
    r.truth(
      "error directs user to new storage",
      /new (?:database|storage)/i.test(r.checks.at(-1).message),
    );
    const after = snapshot(dirname(filename));
    r.equal(
      "original file set preserved",
      after.map((file) => file.name),
      before.map((file) => file.name),
    );
    r.truth(
      "original database and sidecars byte-for-byte unchanged",
      before.every((file, index) => file.bytes.equals(after[index].bytes)),
    );
    r.equal(
      "no inspection copy left behind",
      after.some((file) => file.name.includes(".inspect-")),
      false,
    );
    report.before = hashes(before);
    report.after = hashes(after);
    report.status = "passed";
  } else throw new Error(`Unsupported mode: ${mode}`);
} catch (error) {
  report.status = "failed";
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  if (!crash) {
    await h?.close();
    writer?.close();
    report.closed = true;
  }
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode, kind, pid: process.pid, status: report.status }));
}

if (crash) process.exit(17);
