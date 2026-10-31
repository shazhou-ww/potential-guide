#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type ServerOptions, startTaskServer } from "./index.js";

async function main() {
  const args = process.argv.slice(2);
  if (
    (args[0] === "--help" || args[0] === "-h") &&
    (args.length === 1 || (args.length === 3 && args[1] === "--format" && args[2] === "json"))
  ) {
    const usage = "task-engine-server --config <trusted-local-module.mjs>";
    console.log(
      args.length === 3
        ? JSON.stringify({
            schemaVersion: 1,
            command: "task-engine-server",
            usage,
            configuration: "trusted-local-module",
          })
        : `Usage: ${usage}\nThe default export is a ServerOptions object or async factory. Never accept this path from HTTP.`,
    );
    return;
  }
  if (args.length !== 2 || args[0] !== "--config" || !args[1])
    throw new Error("Usage: task-engine-server --config <trusted-local-module.mjs>");
  const imported = await import(pathToFileURL(resolve(args[1])).href);
  const options = (
    typeof imported.default === "function" ? await imported.default() : imported.default
  ) as ServerOptions;
  const server = await startTaskServer(options);
  console.log(JSON.stringify({ event: "ready", url: server.url, pid: process.pid }));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void server.close().then(
      () => {
        process.removeListener("SIGINT", shutdown);
        process.removeListener("SIGTERM", shutdown);
        console.log(JSON.stringify({ event: "closed" }));
      },
      (error: unknown) => {
        console.error("Shutdown failed; physical cleanup unconfirmed.", error);
        // A failing process must not linger indefinitely, nor claim a clean close.
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
void main().catch((error: unknown) => {
  console.error("Startup failed; physical cleanup unconfirmed.", error);
  // Configuration and failed rollback can retain handles even after main rejects.
  process.exit(1);
});
