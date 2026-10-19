import { type ChildProcess, execFile } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const windowsSnapshotCommand = String.raw`
$ErrorActionPreference='Stop'
try {
  ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | Select-Object ProcessId,ParentProcessId)
} catch {
  $reason = switch -Regex ($_.FullyQualifiedErrorId) {
    '^CommandNotFoundException(?:,|$)' { 'command-not-found'; break }
    '^CouldNotAutoload(?:Matching)?Module(?:,|$)' { 'module-autoload'; break }
    '^Modules_ModuleNotFound(?:,|$)' { 'module-not-found'; break }
    '^Modules_ModuleLoadFailure(?:,|$)' { 'module-load'; break }
    '^Modules_InvalidManifest(?:,|$)' { 'module-manifest'; break }
    '^UnauthorizedAccess(?:,|$)' { 'access-denied'; break }
    '^HRESULT 0x80041003,Microsoft\.Management\.Infrastructure\.CimCmdlets\.GetCimInstanceCommand$' { 'cim-access-denied'; break }
    '^HRESULT 0x80041010,Microsoft\.Management\.Infrastructure\.CimCmdlets\.GetCimInstanceCommand$' { 'cim-invalid-class'; break }
    '^HRESULT 0x8004100E,Microsoft\.Management\.Infrastructure\.CimCmdlets\.GetCimInstanceCommand$' { 'cim-invalid-namespace'; break }
    '^HRESULT 0x800706BA,Microsoft\.Management\.Infrastructure\.CimCmdlets\.GetCimInstanceCommand$' { 'cim-rpc-unavailable'; break }
    default { 'unclassified' }
  }
  [Console]::Error.WriteLine('PGUIDE_WINDOWS_SNAPSHOT_ERROR:' + $reason)
  exit 1
}`;

class WindowsSnapshotCommandError extends Error {}

function snapshotCommandError(cause: unknown, started: number): WindowsSnapshotCommandError {
  // execFile errors include command text and stderr; expose only bounded fields from this fixed query.
  const error = cause as {
    code?: unknown;
    killed?: unknown;
    signal?: unknown;
    stderr?: unknown;
  } | null;
  const code = error?.code;
  const exit =
    typeof code === "number" && Number.isInteger(code) && code >= -2147483648 && code <= 4294967295
      ? String(code)
      : "none";
  const errno =
    typeof code === "string" &&
    [
      "ENOENT",
      "EACCES",
      "EPERM",
      "EINVAL",
      "E2BIG",
      "ENOMEM",
      "ETIMEDOUT",
      "UNKNOWN",
      "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    ].includes(code)
      ? code
      : "none";
  const signal = error?.signal === "SIGTERM" || error?.signal === "SIGKILL" ? error.signal : "none";
  const killed = error?.killed === true;
  const kind =
    errno === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
      ? "output-limit"
      : killed || errno === "ETIMEDOUT"
        ? "timeout"
        : exit !== "none"
          ? "exit"
          : errno !== "none"
            ? "spawn"
            : signal !== "none"
              ? "signal"
              : "unknown";
  const reported =
    typeof error?.stderr === "string"
      ? /(?:^|\r?\n)PGUIDE_WINDOWS_SNAPSHOT_ERROR:(command-not-found|module-autoload|module-not-found|module-load|module-manifest|access-denied|cim-access-denied|cim-invalid-class|cim-invalid-namespace|cim-rpc-unavailable|unclassified)(?:\r?\n|$)/.exec(
          error.stderr,
        )
      : null;
  const reason = reported?.[1] ?? "unclassified";
  const elapsedMs = Math.min(2147483647, Math.max(0, Math.round(performance.now() - started)));
  return new WindowsSnapshotCommandError(
    `windows-snapshot-command[kind=${kind};exit=${exit};errno=${errno};signal=${signal};killed=${killed};elapsedMs=${elapsedMs};reported=${reported !== null};reason=${reason}]`,
    { cause },
  );
}

export async function killProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const execute = promisify(execFile);
  if (process.platform === "win32") {
    let snapshot: { owned: Set<number> } | { error: unknown };
    try {
      const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
      if (systemRoot === undefined)
        throw new Error("Windows process identity query requires SystemRoot.");
      const started = performance.now();
      let stdout: string;
      try {
        ({ stdout } = await execute(
          join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          ["-NoProfile", "-NonInteractive", "-Command", windowsSnapshotCommand],
          { windowsHide: true, timeout: 10_000 },
        ));
      } catch (error) {
        throw snapshotCommandError(error, started);
      }
      const rows: unknown = JSON.parse(stdout);
      if (
        !Array.isArray(rows) ||
        rows.some(
          (row) =>
            row === null ||
            typeof row !== "object" ||
            !Number.isSafeInteger(row.ProcessId) ||
            row.ProcessId < 0 ||
            !Number.isSafeInteger(row.ParentProcessId) ||
            row.ParentProcessId < 0,
        )
      )
        throw new Error("Invalid Windows process tree snapshot.");
      const owned = new Set<number>([child.pid]);
      let previous = 0;
      while (previous !== owned.size) {
        previous = owned.size;
        for (const row of rows) if (owned.has(row.ParentProcessId)) owned.add(row.ProcessId);
      }
      snapshot = { owned };
    } catch (error) {
      snapshot = { error };
    }
    try {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error("Owned root exited during the process tree snapshot.");
      await execute("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    } catch (error) {
      if ("error" in snapshot)
        throw new AggregateError(
          [snapshot.error, error],
          `Process tree termination and ownership snapshot failed.${snapshot.error instanceof WindowsSnapshotCommandError ? ` ${snapshot.error.message}` : ""}`,
        );
      // Concurrent parent/child teardown can make taskkill nonzero after success.
      // Root exit alone is insufficient: every pre-kill owned PID must disappear.
      const deadline = performance.now() + 500;
      while (snapshot.owned.size > 0) {
        for (const pid of snapshot.owned) {
          try {
            process.kill(pid, 0);
          } catch (cause) {
            if ((cause as NodeJS.ErrnoException).code !== "ESRCH")
              throw new AggregateError([error, cause], "Could not verify process tree cleanup.");
            snapshot.owned.delete(pid);
          }
        }
        if (snapshot.owned.size === 0) return;
        if (performance.now() >= deadline) throw error;
        await delay(20);
      }
    }
    if ("error" in snapshot) throw snapshot.error;
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
