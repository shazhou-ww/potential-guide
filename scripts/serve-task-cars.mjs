import { createServer } from "node:http";
import { MemoryIpfsClient } from "../packages/ipfs-content/dist/testing.js";
import { readTaskArtifact } from "../packages/pguide-task-bundle/dist/artifact.js";

const [portText, ...files] = process.argv.slice(2);
const port = Number(portText);
if (portText === undefined || !Number.isInteger(port) || port < 0 || port > 65535 || !files.length)
  throw new Error(
    "Usage: node scripts\\serve-task-cars.mjs <loopback-port-or-0> <prebuilt.car> [...]",
  );
const client = new MemoryIpfsClient();
const roots = [];
for (const file of files) {
  const artifact = await readTaskArtifact(file);
  if (!artifact.archive) throw new Error("Only prebuilt, verified CAR files are accepted.");
  const cid = await client.import(artifact.files);
  if (cid !== artifact.cid) throw new Error("CAR root identity mismatch.");
  roots.push(cid);
}
const server = createServer((request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405).end();
    return;
  }
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  const cid = url.pathname.startsWith("/ipfs/") ? url.pathname.slice(6) : "";
  const bytes = client.blocks.get(cid);
  if (!bytes) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": "application/vnd.ipld.raw" }).end(bytes);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});
console.log(
  JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, pid: process.pid, roots }),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
