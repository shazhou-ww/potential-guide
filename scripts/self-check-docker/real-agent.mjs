import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { keychainState } from "./keychain.mjs";

const reasons = new Set([
  "deadline",
  "model-not-advertised",
  "model-mismatch",
  "permission-denied",
  "incomplete-turn",
  "marker-mismatch",
]);
const modelId = (value) =>
  typeof value === "string" && /^[a-z0-9][a-z0-9._:/-]{0,119}$/i.test(value);
const digest = (value) => createHash("sha256").update(value).digest("hex");

export async function verifyMarker(marker, expected) {
  const details = await lstat(marker);
  return (
    details.isFile() &&
    !details.isSymbolicLink() &&
    details.nlink === 1 &&
    details.size === Buffer.byteLength(expected) &&
    (await readFile(marker, "utf8")) === expected
  );
}

export async function runBaseline(
  { mode = "verify", model, timeoutMs = 120000, runsDirectory = "/work/runs" },
  Client,
) {
  if (
    !["verify", "discover"].includes(mode) ||
    (model !== undefined && !modelId(model)) ||
    (mode === "verify" && model === undefined) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 120000
  )
    throw new Error("Invalid baseline options.");
  await mkdir(runsDirectory, { recursive: true });
  const run = await mkdtemp(join(runsDirectory, "real-agent-"));
  const task = join(run, "task");
  const marker = join(task, "marker.txt");
  const expected = `ready-${randomBytes(24).toString("hex")}`;
  const report = {
    status: "failed",
    mode,
    run,
    requestedModel: model ?? null,
    timeoutMs,
    promptCount: 0,
    deniedRequests: 0,
    markerVerified: false,
    taskCleaned: false,
    timings: {},
  };
  let client;
  let sessionId;
  let timer;
  let stopping;
  let timedOut = false;
  let stage = "setup";
  const started = performance.now();
  const stop = () =>
    (stopping ??= sessionId === undefined ? client.stop() : client.cancelAndStop(sessionId));
  try {
    await mkdir(task, { mode: 0o700 });
    await writeFile(marker, "not-ready", { mode: 0o600 });
    client = new Client(
      {
        connection: { type: "acp", protocolVersion: "1" },
        transport: {
          type: "stdio",
          command: "copilot",
          args: [
            "--acp",
            "--no-auto-update",
            "--disable-builtin-mcps",
            "--no-custom-instructions",
            "--no-ask-user",
            "--log-level",
            "error",
            "--disallow-temp-dir",
            "--deny-tool",
            "shell",
            "--deny-tool",
            "url",
            "--allow-tool",
            `write(${marker})`,
            ...(model === undefined ? [] : ["--model", model]),
          ],
          env: ["HOME", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"],
        },
      },
      async (update) => {
        client.updates.length = 0;
        if (update.method === "pguide/request_denied") report.deniedRequests += 1;
      },
      {
        maxOutputBytes: 196608,
        requireEndTurn: true,
        permissionHandler: async () => {
          report.deniedRequests += 1;
          return undefined;
        },
      },
    );
    timer = setTimeout(() => {
      timedOut = true;
      void stop().catch(() => {});
    }, timeoutMs);
    stage = "initialize";
    await client.initialize("1");
    report.timings.initializeMs = Math.round(performance.now() - started);
    stage = "session-new";
    const session = await client.request("session/new", { cwd: task, mcpServers: [] });
    if (typeof session.sessionId !== "string" || session.sessionId === "")
      throw new Error("Invalid ACP session.");
    sessionId = session.sessionId;
    report.timings.sessionMs = Math.round(performance.now() - started);
    report.selectedModel = modelId(session.models?.currentModelId)
      ? session.models.currentModelId
      : null;
    report.availableModels = [
      ...new Set(
        (session.models?.availableModels ?? []).map((entry) => entry.modelId).filter(modelId),
      ),
    ].slice(0, 100);
    if (timedOut) throw new Error("deadline");
    if (mode === "discover") report.status = "discovered";
    else {
      if (!report.availableModels.includes(model)) throw new Error("model-not-advertised");
      if (report.selectedModel !== model) throw new Error("model-mismatch");
      stage = "prompt";
      report.promptCount = 1;
      const result = await client.prompt(
        sessionId,
        [
          "Repair only marker.txt in the current working directory.",
          `Replace its contents with exactly ${JSON.stringify(expected)}, without a newline.`,
          "Do not use shell, network, Git, configuration changes, or other files.",
          "Make the single file edit and finish. Respect existing permissions.",
        ].join("\n"),
      );
      report.timings.promptFinishedMs = Math.round(performance.now() - started);
      if (timedOut) throw new Error("deadline");
      if (report.deniedRequests !== 0) throw new Error("permission-denied");
      if (result.status !== "completed") throw new Error("incomplete-turn");
      stage = "recheck";
      if (!(await verifyMarker(marker, expected))) throw new Error("marker-mismatch");
      report.markerVerified = true;
      report.markerSha256 = digest(expected);
      report.status = "ready";
    }
  } catch (error) {
    report.failedAt = stage;
    report.reason = timedOut
      ? "deadline"
      : reasons.has(error.message)
        ? error.message
        : /auth(?:entication)?[\s_-]*required|not authenticated|log(?:ged)?[ -]?in|unauthorized/i.test(
              error.message,
            )
          ? "authentication-required"
          : "acp-or-io-failed";
  } finally {
    clearTimeout(timer);
    try {
      if (client !== undefined) await stop();
    } catch {
      report.status = "failed";
      report.reason = "agent-cleanup-failed";
    }
    try {
      await rm(task, { recursive: true, force: true });
      report.taskCleaned = true;
    } catch {
      report.status = "failed";
      report.reason = "task-cleanup-failed";
    }
    report.timings.totalMs = Math.round(performance.now() - started);
  }
  await writeFile(join(run, "baseline.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.getuid?.() === 0) throw new Error("Non-root execution required.");
    const { values } = parseArgs({
      options: {
        mode: { type: "string", default: "verify" },
        model: { type: "string" },
        "timeout-ms": { type: "string", default: "120000" },
      },
    });
    if (keychainState().locked) throw new Error("keychain-locked");
    const { AcpClient } = await import(
      "/opt/objective/packages/pguide-self-check-pilot/runtime/acp-client.mjs"
    );
    const versionOutput = execFileSync("copilot", ["--version"], {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const version = /GitHub Copilot CLI ([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9a-z.-]+)?)/i.exec(
      versionOutput,
    )?.[1];
    if (version === undefined) throw new Error("Unexpected Agent version response.");
    const report = await runBaseline(
      { mode: values.mode, model: values.model, timeoutMs: Number(values["timeout-ms"]) },
      AcpClient,
    );
    const provenance = JSON.parse(await readFile("/harness/provenance.json", "utf8"));
    report.agentVersion = version;
    report.sourceRevision = provenance.sourceRevision;
    await writeFile(join(report.run, "baseline.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (report.status === "failed") process.exitCode = 1;
  } catch (error) {
    console.error(
      error.message === "keychain-locked"
        ? "Real Agent baseline blocked: initialize or unlock the container keychain first."
        : "Real Agent baseline invocation failed; check options, installation and paths.",
    );
    process.exitCode = 1;
  }
}
