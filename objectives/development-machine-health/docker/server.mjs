import { createServer } from "node:http";

createServer((request, response) => {
  response.writeHead(request.url === "/health" ? 200 : 503, { "content-type": "text/plain" });
  response.end(request.url === "/health" ? "ready\n" : "unavailable\n");
}).listen(18080, "127.0.0.1");
