import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, posix } from "node:path";
import {
  absolute,
  directories,
  envelope,
  Fault,
  issue,
  keys,
  numeric,
  own,
  text,
} from "./contract.mjs";
import { directoryProblems } from "./execution.mjs";
export function validateTask(task, scratchDirectory) {
  if (
    !keys(task, [
      "id",
      "state",
      "pid",
      "startedAt",
      "finishedAt",
      "deadlineAt",
      "temporaryDirectory",
    ]) ||
    !own(task, ["id", "state", "startedAt"]) ||
    !text(task.id) ||
    !["active", "finished"].includes(task.state) ||
    !numeric(task.startedAt) ||
    (task.pid !== undefined && (!Number.isSafeInteger(task.pid) || task.pid <= 0)) ||
    (task.state === "active" && task.finishedAt !== undefined) ||
    (task.state === "finished" && !numeric(task.finishedAt)) ||
    (task.finishedAt !== undefined && task.finishedAt < task.startedAt) ||
    (task.deadlineAt !== undefined &&
      (!numeric(task.deadlineAt) || task.deadlineAt < task.startedAt)) ||
    (task.temporaryDirectory !== undefined &&
      (!absolute(task.temporaryDirectory) ||
        posix.dirname(task.temporaryDirectory) !== scratchDirectory))
  )
    return false;
  return true;
}
export function evaluateTasks(tasks, subject, now, livePids, residuePaths) {
  const problems = [];
  const seen = new Set();
  for (const task of tasks) {
    if (
      !validateTask(task, subject.scratchDirectory) ||
      seen.has(task.id) ||
      task.startedAt > now ||
      (task.finishedAt ?? 0) > now
    ) {
      problems.push(
        issue("task-registry-invalid", {
          id: typeof task?.id === "string" ? task.id : "unknown",
          expected: "unique, valid task record without future timestamps",
        }),
      );
      continue;
    }
    seen.add(task.id);
    const live = task.pid !== undefined && livePids.has(task.pid);
    if (task.state === "active") {
      if (!live) problems.push(issue("task-orphaned", { id: task.id, pid: task.pid ?? null }));
      if (task.deadlineAt !== undefined && now > task.deadlineAt)
        problems.push(issue("task-overdue", { id: task.id, deadlineAt: task.deadlineAt, now }));
    } else {
      if (live) problems.push(issue("task-process-leftover", { id: task.id, pid: task.pid }));
      if (
        task.temporaryDirectory &&
        residuePaths.has(task.temporaryDirectory) &&
        now - task.finishedAt > subject.policy.retentionSeconds * 1000
      )
        problems.push(
          issue("task-residue", {
            id: task.id,
            path: task.temporaryDirectory,
            finishedAt: task.finishedAt,
            expected: { retentionSeconds: subject.policy.retentionSeconds },
            actual: { ageSeconds: (now - task.finishedAt) / 1000 },
            recovery:
              "Review retained output and uncommitted work before manually cleaning the registered directory.",
          }),
        );
    }
  }
  return problems;
}
export function processLive(pid) {
  if (pid > 2147483647) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}
export function layoutProblems(subject) {
  const entries = directories.filter((k) => k !== "home").map((key) => [key, subject[key]]);
  const problems = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [a, first] = entries[i];
      const [b, second] = entries[j];
      if (first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`))
        problems.push(
          issue("layout-invalid", {
            directories: [a, b],
            expected: "distinct, non-overlapping managed directories",
            actual: [first, second],
          }),
        );
    }
  }
  if (entries.some(([, path]) => path === subject.home || subject.home.startsWith(`${path}/`)))
    problems.push(
      issue("layout-invalid", { expected: "managed paths must not contain the home directory" }),
    );
  return problems;
}
export async function order(subject, context) {
  const problems = [...layoutProblems(subject), ...(await directoryProblems(subject))];
  if (problems.length) return envelope(problems);
  const records = [];
  const livePids = new Set();
  const residues = new Set();
  let count = 0;
  for (const name of await readdir(subject.tasksDirectory)) {
    if (Date.now() > context.deadline || ++count > 10000)
      throw new Fault("task-registry-bound: directory traversal budget exceeded.", 504);
    if (!name.endsWith(".json")) continue;
    const path = join(subject.tasksDirectory, name);
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid() ||
      info.size > 65536
    ) {
      problems.push(
        issue("task-registry-invalid", {
          file: name,
          expected: "owned regular JSON file <=65536 bytes",
        }),
      );
      continue;
    }
    let task;
    try {
      task = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      problems.push(issue("task-registry-invalid", { file: name, actual: "invalid JSON" }));
      continue;
    }
    if (!validateTask(task, subject.scratchDirectory)) {
      problems.push(
        issue("task-registry-invalid", {
          file: name,
          expected: "valid task schema with an immediate owned scratch child",
        }),
      );
      continue;
    }
    records.push(task);
    if (task.pid !== undefined && processLive(task.pid)) livePids.add(task.pid);
    if (task.temporaryDirectory) {
      try {
        const residue = await lstat(task.temporaryDirectory);
        if (
          !residue.isDirectory() ||
          residue.isSymbolicLink() ||
          residue.uid !== process.getuid() ||
          (await realpath(task.temporaryDirectory)) !== task.temporaryDirectory
        )
          problems.push(
            issue("task-registry-invalid", {
              id: task.id,
              actual: "temporaryDirectory is not an owned canonical directory",
            }),
          );
        residues.add(task.temporaryDirectory);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  problems.push(...evaluateTasks(records, subject, Date.now(), livePids, residues));
  return envelope(problems, [
    "Only registered tasks are inspected; no tracked process or user file is killed or deleted",
  ]);
}
