import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CheckClient, type HostAddress } from "./client.js";

export const hostDirectory = () =>
  process.env.PGUIDE_CHECK_HOST_DIRECTORY ?? join(homedir(), ".potential-guide", "check-host");
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
export async function connectHost(directory = hostDirectory()): Promise<CheckClient> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32" && (await stat(directory)).mode & 0o077)
    throw new Error("Host discovery directory must be user-private.");
  const descriptor = join(directory, "host.json");
  const lock = join(directory, "startup.json");
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    try {
      const address = JSON.parse(await readFile(descriptor, "utf8")) as HostAddress;
      if (alive(address.pid)) {
        const client = new CheckClient(address);
        const response = await fetch(`${address.endpoint}/checks`, {
          headers: { authorization: `Bearer ${address.token}` },
          signal: AbortSignal.timeout(1000),
        });
        if (!response.ok) throw new Error("Live Host descriptor failed authentication.");
        await response.body?.cancel();
        return client;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof TypeError))
        throw error;
    }
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(lock, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      await handle.close();
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("./main.js", import.meta.url)), directory],
        {
          detached: true,
          windowsHide: true,
          stdio: "ignore",
          env: { ...process.env, NODE_OPTIONS: "" },
        },
      );
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        if (handle) await rm(lock, { force: true });
        throw error;
      }
      try {
        const owner = JSON.parse(await readFile(lock, "utf8")) as { pid?: number };
        if (
          typeof owner.pid === "number" &&
          Number.isSafeInteger(owner.pid) &&
          owner.pid > 0 &&
          !alive(owner.pid)
        )
          await rm(lock, { force: true });
      } catch (cause) {
        if (!(cause instanceof SyntaxError) && (cause as NodeJS.ErrnoException).code !== "ENOENT")
          throw cause;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Shared Check Host readiness timed out; inspect the owned startup descriptor.");
}
