import { type ChildProcess, execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
  }
}

async function exited(owned: Set<number>, deadline: number): Promise<boolean> {
  for (;;) {
    for (const pid of owned) {
      try {
        process.kill(pid, 0);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
        owned.delete(pid);
      }
    }
    if (owned.size === 0) return true;
    if (performance.now() >= deadline) return false;
    await delay(Math.min(10, Math.max(1, deadline - performance.now())));
  }
}

export async function stopPosixTree(child: ChildProcess, gracePeriodMs: number): Promise<void> {
  if (child.pid === undefined) return;
  const root = child.pid;
  try {
    // Detached children escape the root's process group. Snapshot before orphaning them.
    const { stdout } = await promisify(execFile)("ps", ["-eo", "pid=,ppid="], {
      timeout: 1000,
      maxBuffer: 1024 * 1024,
    });
    const rows = stdout
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number));
    if (
      rows.some(
        (row) => row.length !== 2 || row.some((value) => !Number.isSafeInteger(value) || value < 0),
      )
    )
      throw new Error("Invalid POSIX process tree snapshot.");
    const owned = new Set<number>([root]);
    let previous = 0;
    while (previous !== owned.size) {
      previous = owned.size;
      for (const [pid, parent] of rows)
        if (pid !== undefined && parent !== undefined && owned.has(parent)) owned.add(pid);
    }
    if (child.exitCode !== null || child.signalCode !== null) owned.delete(root);
    for (const pid of [...owned].reverse()) signalPid(pid, "SIGTERM");
    signalPid(-root, "SIGTERM");
    if (await exited(owned, performance.now() + gracePeriodMs)) return;
    for (const pid of [...owned].reverse()) signalPid(pid, "SIGKILL");
    signalPid(-root, "SIGKILL");
    // Signal delivery is not exit acknowledgement; include bounded OS reaping before scratch removal.
    if (!(await exited(owned, performance.now() + 2000)))
      throw new Error("Owned POSIX process tree did not exit during bounded cleanup.");
  } catch (cause) {
    try {
      signalPid(-root, "SIGKILL");
    } catch (cleanupError) {
      throw new AggregateError([cause, cleanupError], "POSIX process tree cleanup failed.");
    }
    throw cause;
  }
}
