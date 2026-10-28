#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { hostDirectory, optionalPrivateFile, parseHostAddress, processAlive } from "./discovery.js";
import { serve } from "./http.js";
import { CheckKernel } from "./kernel.js";
import { ArtifactManager } from "./artifact-manager.js";
import { TaskScheduler } from "./scheduler.js";
import {
  closePrivateFileBackend,
  ensurePrivateDirectory,
  publishPrivateFile,
  readPrivateFile,
  removePrivateFile,
} from "./private-files.js";

const directory = process.argv[2] ?? hostDirectory();
const reservation = process.argv[3];
if (!reservation || !/^[0-9a-f-]{36}$/.test(reservation))
  throw new Error("Check Host requires a discovery-owned startup reservation.");
await ensurePrivateDirectory(directory);
const previous = await optionalPrivateFile(directory, "host.json");
if (previous !== undefined && processAlive(parseHostAddress(previous).pid))
  throw new Error("A live private Host already owns this directory.");
const startup = await readPrivateFile(directory, "startup.json");
if ((JSON.parse(startup) as { reservation?: string }).reservation !== reservation)
  throw new Error("Host startup reservation changed.");
const claimed = JSON.stringify({ pid: process.pid, reservation });
if (
  startup !== claimed &&
  !(await publishPrivateFile(directory, "startup.json", claimed, startup)) &&
  (await optionalPrivateFile(directory, "startup.json")) !== claimed
)
  throw new Error("Host startup reservation was superseded.");
const kernel = await CheckKernel.create(join(directory, "snapshots"));
const token = randomUUID() + randomUUID();
const configuredOrigins = process.env.PGUIDE_CHECK_SOURCE_ORIGINS?.split(",").filter(Boolean);
const scheduler = new TaskScheduler(
  new ArtifactManager(join(directory, "artifacts"), configuredOrigins),
  kernel,
);
const host = await serve(kernel, token, scheduler);
const descriptor = JSON.stringify({
  endpoint: host.endpoint,
  token,
  pid: process.pid,
  instance: scheduler.instance,
});
try {
  if (
    (await readPrivateFile(directory, "startup.json")) !== claimed ||
    !(await publishPrivateFile(directory, "host.json", descriptor, previous ?? null))
  )
    throw new Error("Host publication ownership changed.");
  await removePrivateFile(directory, "startup.json", claimed);
} catch (error) {
  try {
    await host.close();
    await removePrivateFile(directory, "host.json", descriptor);
  } finally {
    await closePrivateFileBackend();
  }
  throw error;
}
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await host.close();
  await removePrivateFile(directory, "host.json", descriptor);
  await closePrivateFileBackend();
};
process.once("SIGINT", () => {
  void close();
});
process.once("SIGTERM", () => {
  void close();
});
