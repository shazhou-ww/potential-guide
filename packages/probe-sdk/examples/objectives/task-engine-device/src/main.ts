import { createIpfsGatewayClient } from "@potential-guide/ipfs-content";
import { createCheckInvoker } from "@potential-guide/probe-sdk/execution";
import { createProbeTask } from "@potential-guide/probe-sdk";
import { TaskClient } from "@potential-guide/task-engine-http";
import { runTask } from "@potential-guide/task-sdk";
import { definitions } from "../dist/definitions/task-engine-device.js";

const gatewayUrl = "http://127.0.0.1:51231";
const caller = { scope: "probe-local", subject: "task-engine-device" };
const allowedChecks = [
  "bafybeifydrqggqypfapxiwt2bpovdprxae6iysrjhiua3d2jebico74u7a",
  "bafybeicx45guntfoueeddml532gfayxuvo5jhujuf4q2wasnef4ysyrfhe",
  "bafybeibgc2yxmiynaq3m64ptpch6bi4ion7pqx5zh7tda6bfkxqx7ie7si",
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
