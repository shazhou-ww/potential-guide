import { createIpfsGatewayClient } from "@potential-guide/ipfs-content";
import { createCheckInvoker } from "@potential-guide/probe-sdk/execution";
import { createProbeTask } from "@potential-guide/probe-sdk";
import { TaskClient } from "@potential-guide/task-engine-http";
import { runTask } from "@potential-guide/task-sdk";
import { definitions } from "../dist/definitions/monorepo-standard.js";

const gatewayUrl = "http://127.0.0.1:51231";
const caller = { scope: "probe-local", subject: "monorepo-standard" };
const allowedChecks = [
  "bafybeifydrqggqypfapxiwt2bpovdprxae6iysrjhiua3d2jebico74u7a",
  "bafybeicx45guntfoueeddml532gfayxuvo5jhujuf4q2wasnef4ysyrfhe",
  "bafybeia3bpqxern3vs56ewbryvztv2ayodqdt55du5v3s7xrtz24b3eyya",
];
const service = new TaskClient({
  url: gatewayUrl,
  headers: { Authorization: "potential-guide-local-probe" },
});
const invoke = createCheckInvoker({
  service,
  client: createIpfsGatewayClient(gatewayUrl),
  caller,
  timeoutMs: 75_000,
  cleanupTimeoutMs: 5_000,
  authorize: ({ cid }) => allowedChecks.includes(cid),
});

runTask(createProbeTask(definitions, invoke));
