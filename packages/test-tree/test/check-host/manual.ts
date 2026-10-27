import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { CheckClient, readPrivateFile } from "@potential-guide/check-host";
import {
  Context,
  cancel,
  cancelled,
  fault,
  finishHeld,
  inspect,
  owned,
  prepare,
  recover,
  running,
  startHost,
} from "./scenario.js";

async function main() {
  const [action, input, probe, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("Too many arguments");
  if (action === "prepare") {
    assert.equal(input, undefined);
    console.log(await prepare());
    return;
  }
  if (!input)
    throw new Error(
      "Usage: manual.ts prepare | <serve|run|cancel|release|finish|fault|recover|inspect|clean> <directory> [probe]",
    );
  const directory = resolve(input);
  await owned(directory);
  if (action === "serve") {
    const host = await startHost(directory);
    console.log(
      `Ready: ${host.client.address.endpoint}; credentials stay in the private scenario directory. Ctrl+C to stop.`,
    );
    await new Promise<void>((done, reject) => {
      let closing = false;
      const input = createInterface({ input: process.stdin });
      const close = () => {
        if (closing) return;
        closing = true;
        void host
          .close()
          .then(done, reject)
          .finally(() => {
            process.off("SIGINT", close);
            process.off("SIGTERM", close);
            input.close();
          });
      };
      input.on("line", (line) => {
        if (line.trim() === "stop") close();
      });
      process.on("SIGINT", close);
      process.on("SIGTERM", close);
    });
    console.log("Owned Host and workers stopped.");
    return;
  }
  if (action === "clean") {
    const file = join(directory, "manual-host.json");
    try {
      const { pid } = JSON.parse(await readFile(file, "utf8")) as { pid: number };
      assert.ok(Number.isSafeInteger(pid) && pid > 0);
      try {
        process.kill(pid, 0);
        throw new Error("Host PID is still alive; stop it in its own terminal before cleaning");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    return;
  }
  const context = new Context();
  context.directory = directory;
  context.client = new CheckClient(
    JSON.parse(await readPrivateFile(directory, "manual-host.json")),
  );
  switch (action) {
    case "run":
      await running(context);
      break;
    case "cancel":
      await cancel(context);
      break;
    case "release":
      await cancelled(context);
      break;
    case "finish":
      await finishHeld(context);
      break;
    case "fault":
      await fault(context);
      break;
    case "recover":
      await recover(context);
      break;
    case "inspect":
      if (!probe) throw new Error("inspect requires a probe name");
      await inspect(context, probe);
      break;
    default:
      throw new Error(`Unknown action ${action}`);
  }
  console.log(`OK ${action}${probe ? ` ${probe}` : ""} (no credentials displayed)`);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
