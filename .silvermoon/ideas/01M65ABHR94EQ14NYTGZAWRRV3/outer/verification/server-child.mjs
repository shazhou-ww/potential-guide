import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startTaskServer } from "@potential-guide/task-engine-server";
const configure = (await import(pathToFileURL(resolve(process.argv[2])).href)).default;
const server = await startTaskServer(await configure());
process.send({ event: "ready", url: server.url, pid: process.pid });
process.on("message", async (message) => {
  if (message !== "close") return;
  try {
    await server.close();
    process.send({ event: "closed" });
    process.disconnect();
  } catch (error) {
    process.send({ event: "close-failed", message: String(error) });
  }
});
