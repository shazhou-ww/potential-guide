import { execFile, spawn } from "node:child_process";
import { errorCode } from "./result.js";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  missing: boolean;
}

async function stop(pid: number): Promise<void> {
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (errorCode(error) !== "ESRCH") throw error;
    }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 5000 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function executeCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CommandResult> {
  signal?.throwIfAborted();
  if (
    !command ||
    command.includes("\0") ||
    /[\r\n]/.test(command) ||
    args.some((arg) => arg.includes("\0"))
  )
    throw new Error("Invalid command or arguments.");
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command))
    throw new Error("Use a native executable or node with an absolute CLI JavaScript entry.");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let failure: Error | undefined;
    let cleanup: Promise<void> | undefined;
    const terminate = (error: Error) => {
      if (failure) return;
      failure = error;
      if (child.pid !== undefined) {
        cleanup = stop(child.pid);
        cleanup.catch((error: unknown) => {
          failure = new Error("Command process tree cleanup failed.", { cause: error });
        });
      }
    };
    const timer = setTimeout(() => terminate(new Error("Command timed out.")), timeoutMs);
    const abort = () => terminate(new Error("Command cancelled.", { cause: signal?.reason }));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    for (const [stream, name] of [
      [child.stdout, "stdout"],
      [child.stderr, "stderr"],
    ] as const) {
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 262144) {
          terminate(new Error("Command output exceeded 262144 bytes."));
          return;
        }
        if (name === "stdout") stdout += chunk.toString();
        else stderr += chunk.toString();
      });
    }
    child.once("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (errorCode(error) === "ENOENT")
        resolve({ code: 127, stdout: "", stderr: "", missing: true });
      else reject(error);
    });
    child.once("close", async (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (cleanup) {
        try {
          await cleanup;
        } catch (error) {
          reject(new Error("Command process tree cleanup failed.", { cause: error }));
          return;
        }
      }
      if (failure) reject(failure);
      else resolve({ code, stdout, stderr, missing: false });
    });
  });
}
