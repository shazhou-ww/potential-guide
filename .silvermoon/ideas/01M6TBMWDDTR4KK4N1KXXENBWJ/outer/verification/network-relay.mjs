import { createServer } from "node:http";
import { connect } from "node:net";

// Local transport relay: only TLS to the two authorized read origins.
const allowed = new Set(["registry.npmjs.org:443", "pinboard.shazhou.work:443"]);
const sockets = new Set();
const server = createServer((_request, response) => response.writeHead(405).end());
server.on("connect", (request, client, head) => {
  if (!allowed.has(request.url)) {
    client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const upstream = connect(443, request.url.split(":")[0]);
  sockets.add(client);
  sockets.add(upstream);
  client.on("close", () => {
    sockets.delete(client);
    upstream.destroy();
  });
  upstream.on("close", () => {
    sockets.delete(upstream);
    client.destroy();
  });
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  upstream.on("connect", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    client.pipe(upstream).pipe(client);
  });
});
server.listen(0, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "ready", port: server.address().port, pid: process.pid }));
});
process.on("SIGTERM", () => {
  for (const socket of sockets) socket.destroy();
  server.close(() => console.log(JSON.stringify({ event: "closed" })));
});
