#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hostDirectory } from "./discovery.js";
import { serve } from "./http.js";
import { CheckKernel } from "./kernel.js";

const directory = process.argv[2] ?? hostDirectory();
const kernel = await CheckKernel.create(join(directory, "snapshots"));
const token = randomUUID() + randomUUID();
const host = await serve(kernel, token);
const instance = randomUUID();
const prepared = join(directory, `${instance}.json`);
await writeFile(prepared, JSON.stringify({ endpoint: host.endpoint, token, pid: process.pid, instance }), { flag: "wx", mode: 0o600 });
await rename(prepared, join(directory, "host.json"));
await rm(join(directory, "startup.json"), { force: true });
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await host.close();
  await rm(join(directory, "host.json"), { force: true });
};
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });
