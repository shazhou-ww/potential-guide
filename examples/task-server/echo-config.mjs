import { createIpfsGatewayClient } from "@potential-guide/ipfs-content";
import { TaskError } from "@potential-guide/task-protocol";

export default function configure() {
  const token = process.env.TASK_SERVER_TOKEN;
  if (!token) throw new Error("Set TASK_SERVER_TOKEN.");
  return configureTaskServer({
    token,
    port: Number(process.env.TASK_SERVER_PORT ?? 3000),
    database: process.env.TASK_SERVER_DATABASE ?? "tasks.sqlite",
  });
}

export async function configureTaskServer({ token, port = 0, database, ipfsClient }) {
  if (!ipfsClient && !process.env.IPFS_GATEWAY)
    throw new Error("Set IPFS_GATEWAY to a read-only Gateway URL or inject ipfsClient.");
  ipfsClient ??= createIpfsGatewayClient(process.env.IPFS_GATEWAY);
  return {
    port,
    database,
    ipfsClient,
    limits: {
      maxConcurrent: 4,
      maxPayloadBytes: 96 * 1024 * 1024,
      queryPageBytes: 96 * 1024 * 1024,
      sourceEnvelopeBytes: 96 * 1024 * 1024,
    },
    authorize: (caller, _operation, scope) =>
      caller.scope === scope && caller.subject === "example",
    resolveCaller(request) {
      if (request.headers.get("authorization") !== `Bearer ${token}`)
        throw new TaskError("unauthenticated", "Authentication required.");
      return { scope: "example", subject: "example" };
    },
  };
}
