import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "cross-spawn";

export function execute(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolveRun({ code: code ?? (signal === undefined ? 70 : 5), signal, stdout, stderr }),
    );
    options.onSpawn?.(child);
    if (options.input === undefined) child.stdin.end();
    else child.stdin.end(options.input);
  });
}

export async function createDeploymentWorkspace() {
  const cache = fileURLToPath(new URL("../.cache/", import.meta.url));
  await mkdir(cache, { recursive: true });
  const created = await mkdtemp(join(cache, "potential-guide-deployment-"));
  const path = await realpath(created);
  let cleaned = false;

  return {
    path,
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    },
  };
}
