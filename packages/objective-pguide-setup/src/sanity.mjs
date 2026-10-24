import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Fault, Problem, record } from "./contract.mjs";
import { jsonOutput } from "./installation.mjs";
export async function sanity(
  subject,
  context,
  directory,
  selected,
  objectivePackages = {},
  expectedRevision,
) {
  const repository = join(directory, "fixture");
  await mkdir(repository);
  const markerPackage = objectivePackages["@potential-guide/objective-setup-marker"];
  if (typeof markerPackage !== "string")
    throw new Fault(
      "protocol: prepare the fixed standalone marker Objective package before sanity.",
    );

  const marker = join(repository, "marker.txt");
  const expected = randomBytes(24).toString("hex");
  await writeFile(marker, "not-repaired");
  const subjectFile = join(directory, "sanity-subject.json");
  await writeFile(subjectFile, JSON.stringify({ marker, expected }));
  await mkdir(join(repository, ".pguide"), { recursive: true });
  const configPath = join(repository, ".pguide", "config.jsonc");
  // The outer deadline already bounds preparation, execution and cleanup. A fixed
  // reserve could exhaust regulation during module startup, before any ACP prompt.
  const timeoutMs = subject.timeoutMs;
  const config = {
    "pguide.commandDirectories": (selected.config["pguide.commandDirectories"] ?? []).map((path) =>
      resolve(subject.workingDirectory, path),
    ),
    "agents.defaultAgent": selected.name,
    "cli-core.stateDirectory": join(directory, "state"),
    "regulate.agentTimeoutMs": timeoutMs,
    "regulate.quota": { timeoutMs, maxAgentRuns: 1, maxStallRuns: 1 },
    "pilot.probe": { timeoutMs: 3000, retry: { maxRetries: 0, delayMs: 0 } },
    "pilot.reportsEnabled": false,
    "pilot.reportDirectory": join(directory, "reports"),
    "regulate.permissions": selected.config["regulate.permissions"],
  };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await mkdir(join(repository, ".pguide"), { recursive: true });
  await writeFile(
    join(repository, ".pguide", "agents.yaml"),
    JSON.stringify({
      $schema: "https://shazhou-ww.github.io/potential-guide/schemas/agents/v1.json",
      agents: { [selected.name]: selected.profile },
    }),
    { mode: 0o600 },
  );
  const common = ["--pilot", markerPackage, "--subject-file", subjectFile];
  const probe = async () => {
    const result = await context.cli(["probe", ...common], repository);
    const report = jsonOutput(result);
    if (result.code !== 0 || report.status !== 200 || !record(report.payload)) {
      const reason =
        typeof report.error === "string" && /dirty|uncommitted/.test(report.error)
          ? "dirty-source"
          : typeof report.error === "string" && /long|ENAMETOOLONG/.test(report.error)
            ? "source-path"
            : "invocation";
      throw new Fault(
        `protocol: independent sanity probe failed (${reason}; exit=${Number.isInteger(result.code) ? result.code : "unknown"}).`,
      );
    }
    return report.payload;
  };
  const initial = await probe();
  const markerId = "@potential-guide/objective-setup-marker";
  const markerRevision = expectedRevision ?? initial.versions?.[markerId];
  if (
    initial.current?.objectiveId !== markerId ||
    !/^sha256-pguide-package-v1:[a-f0-9]{64}$/.test(markerRevision ?? "") ||
    initial.versions?.[markerId] !== markerRevision
  )
    throw new Fault("protocol: marker package identity or fixed content revision mismatch.");
  if (
    initial.current?.levelId !== "initial" ||
    !initial.problems?.some((entry) => entry.ref?.problemId === "marker-incorrect")
  )
    throw new Fault("sanity: initial failure was not independently observed.");
  const result = await context.cli(
    ["regulate", ...common, "--target", "terminal", "--agent", selected.name],
    repository,
  );
  const report = jsonOutput(result);
  if (result.code !== 0) {
    if (result.code !== 5 || report.outcome?.stopReason !== "exhausted") {
      // Only fixed diagnostic labels cross this boundary, never Agent/config/auth error text.
      const status = ["acp-error", "regulation-error", "io-error", "internal-error"].includes(
        report.status,
      )
        ? report.status
        : "unrecognized";
      const snapshotDiagnostic =
        typeof report.error === "string"
          ? /windows-snapshot-command\[kind=(?:timeout|exit|spawn|signal|output-limit|unknown);exit=(?:-?\d{1,10}|none);errno=(?:ENOENT|EACCES|EPERM|EINVAL|E2BIG|ENOMEM|ETIMEDOUT|UNKNOWN|ERR_CHILD_PROCESS_STDIO_MAXBUFFER|none);signal=(?:SIGTERM|SIGKILL|none);killed=(?:true|false);elapsedMs=\d{1,10};reported=(?:true|false);nativeCode=(?:\d{1,10}|none);phase=(?:unreported|started|importing|imported|compiling|compiled|query-started|queried|serialized|exiting);reason=(?:command-not-found|module-autoload|module-not-found|module-load|module-manifest|access-denied|native-snapshot|native-first|native-next|native-close|unclassified)\]/.exec(
              report.error,
            )?.[0]
          : undefined;
      const diagnostic =
        snapshotDiagnostic ??
        [
          ["PguideWindowsProcessSnapshot", "windows-snapshot-command"],
          ["Invalid Windows process tree snapshot.", "windows-snapshot-format"],
          ["Process tree termination and ownership snapshot failed.", "windows-tree-and-snapshot"],
          ["Could not verify process tree cleanup.", "windows-tree-unobservable"],
          ["Check timed out after 3000ms.", "inner-probe-deadline"],
        ].find(
          ([message]) => typeof report.error === "string" && report.error.includes(message),
        )?.[1] ??
        "unclassified";
      throw new Fault(
        `regulate: Agent or probe invocation failed (exit=${result.code ?? "signal"}, status=${status}, diagnostic=${diagnostic}).`,
      );
    }
    if (["time", "agent-limit"].includes(report.outcome.exhaustedBy))
      throw new Fault("timeout: sanity regulation exhausted its time allowance.", 504);
    if (!["agent-runs", "stall"].includes(report.outcome.exhaustedBy))
      throw new Fault("protocol: unknown sanity exhaustion reason.");
    throw new Problem("sanity-failed", {
      stage: "regulate",
      reason: "quota-exhausted",
      exhaustedBy: report.outcome.exhaustedBy,
    });
  }
  if (report.outcome?.stopReason !== "target-reached" || report.outcome?.iterations !== 1)
    throw new Fault("protocol: unexpected sanity regulation outcome.");
  const final = await probe();
  if (final.current?.objectiveId !== markerId || final.versions?.[markerId] !== markerRevision)
    throw new Fault("protocol: marker package changed during the bounded sanity exercise.");
  let correct = false;
  try {
    const details = await lstat(marker);
    correct =
      details.isFile() &&
      details.size === expected.length &&
      (await readFile(marker, "utf8")) === expected;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!correct || final.current?.levelId !== "repaired" || final.problems?.length !== 0)
    throw new Problem("sanity-failed", {
      stage: "recheck",
      reason: !correct ? "nonce-mismatch" : "target-not-reached",
    });
}
