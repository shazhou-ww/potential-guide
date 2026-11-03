import { createIpfsClient } from "@potential-guide/ipfs-content";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { startUiServer, validateUiConfig } from "@potential-guide/task-engine-web-ui/server";
import {
  type Authorize,
  type Caller,
  type Operation,
  TaskError,
} from "@potential-guide/task-protocol";
import { type ServiceConfig, validateLayer } from "./config.js";

const operations = new Set<Operation>([
  "submit",
  "request",
  "task",
  "run",
  "cancel",
  "history",
  "subscribe",
  "list",
  "list-runs",
  "message",
]);
export function localPolicy(scope: string, origin: () => string) {
  const caller: Caller = Object.freeze({ subject: "local-cli", scope });
  const authorize: Authorize = (identity, operation, target) =>
    identity.subject === caller.subject &&
    identity.scope === scope &&
    target === scope &&
    operations.has(operation);
  return {
    authorize,
    resolveCaller(request: Request): Caller {
      const expected = origin();
      const site = request.headers.get("sec-fetch-site");
      if (
        !expected ||
        request.headers.get("host") !== new URL(expected).host ||
        (request.headers.has("origin") && request.headers.get("origin") !== expected) ||
        (site !== null && site !== "same-origin" && site !== "none") ||
        !["GET", "POST"].includes(request.method) ||
        (request.method === "POST" &&
          request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
            "application/json")
      )
        throw new TaskError("forbidden", "Local service request policy denied access.");
      return caller;
    },
  };
}

export async function startService(raw: ServiceConfig) {
  const config = validateLayer(raw, process.cwd(), "effective configuration") as ServiceConfig;
  const uiConfig = {
    ...config.uiOptions,
    endpoints: [
      { id: "local", label: "Local Task Engine", binding: config.scope, url: "http://127.0.0.1:1" },
    ],
  };
  // All declarative options are checked before any DB or listening socket is opened.
  validateUiConfig(uiConfig);
  let origin = "";
  const policy = localPolicy(config.scope, () => origin);
  const server = await startTaskServer({
    host: config.host,
    port: config.port,
    database: config.database,
    ipfsClient: await createIpfsClient(config.ipfsRpcUrl),
    ...policy,
  });
  origin = server.url;
  let ui: Awaited<ReturnType<typeof startUiServer>> | undefined;
  try {
    if (config.ui)
      ui = await startUiServer({
        ...uiConfig,
        endpoints: [{ ...uiConfig.endpoints[0]!, url: server.url }],
      });
  } catch (error) {
    try {
      await server.close();
    } catch {
      throw new Error("UI startup and Engine rollback failed; cleanup unconfirmed.");
    }
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    url: server.url,
    ...(ui ? { uiUrl: ui.url } : {}),
    close(): Promise<void> {
      closing ??= (async () => {
        const failures: unknown[] = [];
        try {
          await ui?.close();
        } catch (error) {
          failures.push(error);
        }
        try {
          await server.close();
        } catch (error) {
          failures.push(error);
        }
        if (failures.length) throw new Error("Service cleanup unconfirmed.");
      })();
      return closing;
    },
  };
}
