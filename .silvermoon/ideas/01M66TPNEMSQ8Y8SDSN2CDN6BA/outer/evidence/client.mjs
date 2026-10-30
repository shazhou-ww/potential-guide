// 第二个客户端是独立进程，只通过 HTTP 发送原始请求。
const { url, body, requestId } = JSON.parse(process.argv[2]);
const response = await fetch(`${url}/tasks`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-proof-client": "beta",
    "Idempotency-Key": requestId,
    Connection: "close",
  },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(10_000),
});
console.log(
  JSON.stringify({ pid: process.pid, status: response.status, body: await response.json() }),
);
