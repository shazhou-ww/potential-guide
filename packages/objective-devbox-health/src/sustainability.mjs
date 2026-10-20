import { lstat, readdir, statfs } from "node:fs/promises";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { envelope, Fault, issue, numeric, record, sampleKeys, validSample } from "./contract.mjs";
import { directoryProblems, execute, optionalFile } from "./execution.mjs";
import { layoutProblems } from "./order.mjs";
import { packageManager } from "./system.mjs";
export function evaluateHistory(history, subject, identityValue, now) {
  const p = subject.policy;
  if (!history?.length)
    return [
      issue("history-insufficient", {
        expected: `${p.historyMinSamples} samples spanning ${p.historyMinSpanMs}ms`,
        actual: 0,
      }),
    ];
  let previous = -1;
  const bounded = (value) => {
    if (typeof value === "string") return value.slice(0, 256);
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
    if (value === undefined || value === null) return null;
    return `[${Array.isArray(value) ? "array" : typeof value}]`;
  };
  for (const [index, entry] of history.entries()) {
    let reason;
    if (!validSample(entry)) reason = "invalid-sample";
    else if (
      entry.hostname !== identityValue.hostname ||
      entry.user !== subject.user ||
      entry.home !== subject.home
    )
      reason = "identity-mismatch";
    else if (entry.measuredAt <= previous) reason = "timestamp-order";
    else if (entry.measuredAt > now) reason = "future-timestamp";
    if (reason) {
      return [
        issue("history-invalid", {
          index,
          reason,
          expected: {
            hostname: bounded(identityValue.hostname),
            user: bounded(subject.user),
            home: bounded(subject.home),
            measuredAt: { greaterThan: previous, maximum: now },
            metrics: "finite nonnegative numbers",
          },
          actual: Object.fromEntries(
            sampleKeys.map((key) => [key, bounded(record(entry) ? entry[key] : undefined)]),
          ),
        }),
      ];
    }
    previous = entry.measuredAt;
  }
  const first = history[0];
  const last = history.at(-1);
  const span = last.measuredAt - first.measuredAt;
  if (
    history.length < p.historyMinSamples ||
    span < p.historyMinSpanMs ||
    now - last.measuredAt > p.historyMaxAgeMs
  )
    return [
      issue("history-insufficient", {
        expected: {
          samples: p.historyMinSamples,
          spanMs: p.historyMinSpanMs,
          maxAgeMs: p.historyMaxAgeMs,
        },
        actual: { samples: history.length, spanMs: span, ageMs: now - last.measuredAt },
      }),
    ];
  const problems = [];
  for (const [metric, limit, id] of [
    ["cacheBytes", p.maxCacheGrowthBytesPerSecond, "cache-growth"],
    ["logBytes", p.maxLogGrowthBytesPerSecond, "log-growth"],
  ]) {
    const growth = (last[metric] - first[metric]) / (span / 1000);
    if (growth > limit)
      problems.push(
        issue(id, {
          expected: limit,
          actual: growth,
          unit: "bytes/second",
          spanMs: span,
          recovery:
            "Review growth and configure bounded retention; never blindly delete caches or logs.",
        }),
      );
  }
  return problems;
}
export async function treeBytes(root, deadline) {
  let bytes = 0;
  let count = 0;
  const pending = [root];
  while (pending.length) {
    if (Date.now() > deadline || ++count > 100000)
      throw new Fault("sample-bound: directory traversal budget exceeded.", 504);
    const path = pending.pop();
    const info = await lstat(path);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      for (const entry of await readdir(path)) pending.push(join(path, entry));
    } else if (info.isFile()) bytes += info.size;
  }
  return bytes;
}
export async function localSample(subject, context) {
  const problems = [...layoutProblems(subject), ...(await directoryProblems(subject))];
  if (problems.length) throw new Fault(`sample-directory: ${JSON.stringify(problems)}`, 409);
  const identityValue = userInfo();
  if (
    identityValue.uid === 0 ||
    identityValue.username !== subject.user ||
    identityValue.homedir !== subject.home ||
    process.env.HOME !== subject.home
  )
    throw new Fault("sample-identity: run as the declared non-root user with its HOME.", 409);
  const fs = await statfs(subject.workspace, { bigint: true });
  const cacheBytes = await treeBytes(subject.cacheDirectory, context.deadline);
  const logBytes = await treeBytes(subject.logDirectory, context.deadline);
  return {
    hostname: hostname(),
    user: identityValue.username,
    home: identityValue.homedir,
    measuredAt: Date.now(),
    freeBytes: Number(fs.bavail * fs.bsize),
    freeInodes: Number(fs.ffree),
    cacheBytes,
    logBytes,
  };
}
export function packageIndexProblem(indexTimes, stampTime, policy, now) {
  const source = stampTime === undefined ? "oldest Packages mtime" : "update-success-stamp mtime";
  const evidence = stampTime === undefined ? Math.min(...indexTimes) : stampTime;
  if (
    !indexTimes.length ||
    !numeric(evidence) ||
    indexTimes.some((time) => !numeric(time) || time > now) ||
    evidence > now ||
    now - evidence > policy.maxPackageIndexAgeSeconds * 1000
  )
    return issue("package-index-stale", {
      expected: policy.maxPackageIndexAgeSeconds,
      actual: !indexTimes.length
        ? "missing Packages indexes"
        : numeric(evidence)
          ? (now - evidence) / 1000
          : "invalid refresh evidence",
      source,
      unit: "seconds",
      recovery:
        "Explicitly refresh apt indexes outside this check; record an update-success-stamp only after a successful refresh.",
    });
  return null;
}
export async function sustainability(subject, context) {
  const problems = await directoryProblems(subject);
  if (problems.length) return envelope(problems);
  problems.push(...evaluateHistory(subject.history, subject, { hostname: hostname() }, Date.now()));
  const unsupported = await packageManager(context);
  if (unsupported) problems.push(unsupported);
  else {
    const lists = "/var/lib/apt/lists";
    const indexes = [];
    try {
      let count = 0;
      for (const name of await readdir(lists)) {
        if (Date.now() > context.deadline || ++count > 10000)
          throw new Fault("package-index-bound: directory traversal budget exceeded.", 504);
        if (/(?:^|_)Packages(?:\.(?:lz4|gz|xz|bz2|zst))?$/.test(name)) {
          const info = await lstat(join(lists, name));
          if (info.isFile() && !info.isSymbolicLink()) indexes.push(info.mtimeMs);
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    let stampTime;
    try {
      const stamp = await lstat("/var/lib/apt/periodic/update-success-stamp");
      stampTime =
        stamp.isFile() && !stamp.isSymbolicLink() && stamp.uid === 0 ? stamp.mtimeMs : null;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const indexProblem = packageIndexProblem(indexes, stampTime, subject.policy, Date.now());
    if (indexProblem) problems.push(indexProblem);
    const upgrade = await execute(
      "apt-get",
      ["-s", "-o", "Debug::NoLocking=1", "upgrade"],
      context,
    );
    if (upgrade.code !== 0)
      throw new Fault(
        `package-upgrade-simulation: exit ${upgrade.code}: ${upgrade.stderr.slice(0, 2048)}`,
      );
    const summary =
      /(\d+) upgraded, (\d+) newly installed, (\d+) to remove and (\d+) not upgraded/.exec(
        upgrade.stdout,
      );
    if (!summary) throw new Fault("package-upgrade-simulation: unrecognized apt-get summary.");
    if (summary.slice(1).some((number) => Number(number) > 0))
      problems.push(
        issue("updates-pending", {
          actual: {
            upgraded: Number(summary[1]),
            installed: Number(summary[2]),
            removed: Number(summary[3]),
            held: Number(summary[4]),
          },
          recovery:
            "Review and apply appropriate updates explicitly; this check never installs packages.",
        }),
      );
  }
  if (subject.environment === "native-linux") {
    if ((await optionalFile("/var/run/reboot-required")) !== null)
      problems.push(
        issue("reboot-required", {
          recovery: "Schedule a controlled native-machine reboot after saving work.",
        }),
      );
  }
  return envelope(problems, [
    "Package update simulation uses local indexes only; it is not a live security-status proof",
    ...(subject.environment === "native-linux"
      ? []
      : ["Reboot: not applicable (container/WSL host kernel control excluded)"]),
  ]);
}
