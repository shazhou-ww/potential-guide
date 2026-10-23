import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CheckClient, type HostAddress } from "./client.js";
import {
  createPrivateFile,
  ensurePrivateDirectory,
  publishPrivateFile,
  readPrivateFile,
  removePrivateFile,
} from "./private-files.js";

export const hostDirectory = () =>
  process.env.PGUIDE_CHECK_HOST_DIRECTORY ?? join(homedir(), ".potential-guide", "check-host");
export const processAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
export function parseHostAddress(text: string): HostAddress {
  let address: Partial<HostAddress> | null;
  try {
    address = JSON.parse(text) as Partial<HostAddress> | null;
  } catch {
    throw new Error("Invalid private Host descriptor.");
  }
  if (
    !address ||
    !Number.isSafeInteger(address.pid) ||
    (address.pid ?? 0) < 1 ||
    typeof address.endpoint !== "string" ||
    typeof address.instance !== "string" ||
    typeof address.token !== "string" ||
    !/^[A-Za-z0-9_-]{32,512}$/.test(address.token)
  )
    throw new Error("Invalid private Host descriptor.");
  new CheckClient(address as HostAddress);
  return address as HostAddress;
}
export async function optionalPrivateFile(directory: string, name: string) {
  try {
    return await readPrivateFile(directory, name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function connectHost(directory = hostDirectory()): Promise<CheckClient> {
  directory = resolve(directory);
  await ensurePrivateDirectory(directory);
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    try {
      const descriptor = await optionalPrivateFile(directory, "host.json");
      if (descriptor !== undefined) {
        const address = parseHostAddress(descriptor);
        if (processAlive(address.pid)) {
          const client = new CheckClient(address);
          const response = await fetch(`${address.endpoint}/checks`, {
            headers: { authorization: `Bearer ${address.token}` },
            signal: AbortSignal.timeout(1000),
          });
          if (!response.ok) throw new Error("Live Host descriptor failed authentication.");
          await response.body?.cancel();
          return client;
        }
      }
      const record = JSON.stringify({ pid: process.pid, reservation: randomUUID() });
      let created = false;
      try {
        await createPrivateFile(directory, "startup.json", record);
        created = true;
        const published = await optionalPrivateFile(directory, "host.json");
        if (published !== undefined && processAlive(parseHostAddress(published).pid)) {
          await removePrivateFile(directory, "startup.json", record);
          continue;
        }
        const reservation = (JSON.parse(record) as { reservation: string }).reservation;
        const child = spawn(
          process.execPath,
          [fileURLToPath(new URL("./main.js", import.meta.url)), directory, reservation],
          {
            cwd: directory,
            detached: true,
            windowsHide: true,
            stdio: "ignore",
            env: { ...process.env, NODE_OPTIONS: "" },
          },
        );
        await new Promise<void>((done, reject) => {
          child.once("spawn", done);
          child.once("error", reject);
        });
        child.unref();
        // A child can die before main claims the reservation while its launcher stays alive.
        await publishPrivateFile(
          directory,
          "startup.json",
          JSON.stringify({ pid: child.pid, reservation }),
          record,
        );
      } catch (error) {
        if (created) await removePrivateFile(directory, "startup.json", record);
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const observed = await optionalPrivateFile(directory, "startup.json");
        if (observed !== undefined) {
          try {
            const owner = JSON.parse(observed) as { pid?: number } | null;
            if (
              owner &&
              typeof owner.pid === "number" &&
              Number.isSafeInteger(owner.pid) &&
              owner.pid > 0 &&
              !processAlive(owner.pid)
            )
              await removePrivateFile(directory, "startup.json", observed);
          } catch (cause) {
            if (!(cause instanceof SyntaxError)) throw cause;
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Shared Check Host readiness timed out; inspect the private startup descriptor.");
}
