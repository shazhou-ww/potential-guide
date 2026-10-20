import { randomBytes } from "node:crypto";
import { cp, lstat, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Fault, here, Problem, record } from "./contract.mjs";
import { jsonOutput } from "./installation.mjs";
export async function sanity(subject, context, directory, selected) {
  const repository = join(directory, "fixture");
  await cp(join(here, "sanity-fixture"), repository, { recursive: true });
  await writeFile(
    join(repository, ".gitignore"),
    await readFile(join(repository, "gitignore"), "utf8"),
  );

  const marker = join(repository, "marker.txt");
  const expected = randomBytes(24).toString("hex");
  await writeFile(marker, "not-repaired");
  const subjectFile = join(directory, "sanity-subject.json");
  await writeFile(subjectFile, JSON.stringify({ marker, expected }));
  const configPath = join(directory, "sanity-config.json");
  // The outer deadline already bounds preparation, execution and cleanup. A fixed
  // reserve could exhaust regulation during module startup, before any ACP prompt.
  const timeoutMs = subject.timeoutMs;
  const config = {
    schemaVersion: 2,
    commandDirectories: (selected.config.commandDirectories ?? []).map((path) =>
      resolve(subject.workingDirectory, path),
    ),
    defaultAgent: selected.name,
    agents: { [selected.name]: selected.profile },
    stateDirectory: join(directory, "state"),
    agentExecutionLimits: { timeoutMs },
    regulationStrategy: {
      quota: { timeoutMs, maxAgentRuns: 1, maxStallRuns: 1 },
      probe: { timeoutMs: 3000, retry: { maxRetries: 0, delayMs: 0 } },
    },
  };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const git = async (...args) => {
    const result = await context.execute("git", ["-C", repository, ...args], {
      missing: "git-unavailable",
    });
    if (result.code !== 0) throw new Fault("git: isolated fixture preparation failed.");
    return result.stdout.trim();
  };
  await git("init", "-q");
  await git("config", "user.name", "pguide setup");
  await git("config", "user.email", "setup@example.invalid");
  await git("add", ".");
  await git("-c", "commit.gpgsign=false", "commit", "-qm", "Bounded setup fixture");
  const revision = await git("rev-parse", "HEAD");
  const uri = `git+${pathToFileURL(repository).href}#/`;
  const common = ["--pilot", uri, "--revision", revision, "--subject-file", subjectFile];
  const probe = async () => {
    const result = await context.cli(["probe", ...common], configPath, repository);
    const report = jsonOutput(result);
    if (result.code !== 0 || report.status !== 200 || !record(report.payload))
      throw new Fault("protocol: independent sanity probe failed.");
    return report.payload;
  };
  const initial = await probe();
  if (
    initial.current?.levelId !== "unrepaired" ||
    !initial.problems?.some((entry) => entry.ref?.problemId === "marker-incorrect")
  )
    throw new Fault("sanity: initial failure was not independently observed.");
  const result = await context.cli(
    ["regulate", ...common, "--target", "terminal", "--agent", selected.name],
    configPath,
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
  if (!correct || final.current?.levelId !== "terminal" || final.problems?.length !== 0)
    throw new Problem("sanity-failed", {
      stage: "recheck",
      reason: !correct ? "nonce-mismatch" : "target-not-reached",
    });
}
