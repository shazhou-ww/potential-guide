import { type ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export async function killProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    try {
      await execute("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) throw error;
    }
    return;
  }
  // Include descendants that started their own process group, such as probes.
  const { stdout } = await execute("ps", ["-eo", "pid=,ppid="]);
  const rows = stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  const descendants = new Set<number>([child.pid]);
  let previous = 0;
  while (previous !== descendants.size) {
    previous = descendants.size;
    for (const [pid, parent] of rows)
      if (pid !== undefined && parent !== undefined && descendants.has(parent))
        descendants.add(pid);
  }
  for (const pid of [...descendants].reverse()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}
