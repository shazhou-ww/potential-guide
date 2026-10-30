import { readFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createArtifactSource, createCheckTaskType } from "@potential-guide/check-task";
import { TaskError } from "@potential-guide/task-protocol";
export default function configure() {
  const source = createArtifactSource({
    allowedOrigins: ["https://deployment.invalid"],
    allowedFileRoots: process.env.FILE_ROOTS === "deny" ? [] : [resolve("imports")],
    authorize(_reference, scope) {
      if (scope !== "one") throw new TaskError("artifact_source_denied", "Source scope denied.");
    },
    async download(url) {
      if (!url.startsWith("https:")) throw Error("File URL reached the HTTPS-only hook.");
      await appendFile("downloads.jsonl", `${JSON.stringify({ url, pid: process.pid, mode: process.env.MODE })}\n`);
      if (process.env.MODE === "restart") throw Error("Restoration may not fetch replacement content.");
      const path = new URL(url).pathname;
      if (path === "/invalid.tgz") return Buffer.from("invalid archive");
      return readFile(resolve(path === "/runtime.tgz" ? "runtime.tgz" : "checker.tgz"));
    },
  });
  const check = createCheckTaskType({
    source, directory: process.env.WORKERS, workers: 1, graceMs: 25, wallMs: 60000,
  });
  return {
    port: 0, database: process.env.DATABASE,
    types: [check], currentVersions: { check: "1" },
    authorize: (caller, operation, scope) => caller.scope === scope &&
      (caller.subject === "operator" || ["task", "request", "history", "subscribe"].includes(operation)),
    resolveCaller(request) {
      const token = request.headers.get("authorization");
      if (!["Bearer operator", "Bearer other", "Bearer reader"].includes(token))
        throw new TaskError("unauthenticated", "Authentication required.");
      return {
        scope: token === "Bearer other" ? "two" : "one",
        subject: token === "Bearer reader" ? "reader" : "operator",
      };
    },
    async closeResources() { await check.close(); await source.close(); },
    http: { pollMs: 10 },
  };
}
