import { readFile, statfs } from "node:fs/promises";
import { directories, envelope, Fault, issue } from "./contract.mjs";
import { directoryProblems, execute } from "./execution.mjs";
export function capacityProblems(freeBytes, freeInodes, policy, path = "") {
  const problems = [];
  if (freeBytes < policy.minFreeBytes)
    problems.push(
      issue("capacity-low", {
        path,
        expected: policy.minFreeBytes,
        actual: freeBytes,
        unit: "bytes",
      }),
    );
  if (freeInodes < policy.minFreeInodes)
    problems.push(
      issue("inodes-low", {
        path,
        expected: policy.minFreeInodes,
        actual: freeInodes,
        unit: "inodes",
      }),
    );
  return problems;
}
export async function packageManager(context) {
  const release = await readFile("/etc/os-release", "utf8");
  const id = /^ID=(?:"([^"]+)"|([^\n]+))$/m.exec(release);
  if (!["debian", "ubuntu"].includes(id?.[1] ?? id?.[2]))
    return issue("unsupported-package-manager", {
      expected: "Debian or Ubuntu with dpkg and apt-get",
      actual: id?.[1] ?? id?.[2] ?? "unknown",
    });
  for (const tool of ["dpkg", "apt-get"]) {
    const result = await execute(tool, ["--version"], context);
    if (result.code !== 0)
      return issue("unsupported-package-manager", {
        tool,
        expected: "available",
        actual: result.code,
      });
  }
  return null;
}
export function packageDependencyProblem(result) {
  if (result.missing) throw new Fault("package-dependency-check: apt-get missing.");
  if (result.code === 0) return null;
  const diagnostic = `${result.stdout}\n${result.stderr}`;
  if (
    result.code === 100 &&
    /unmet dependenc|broken (?:packages|dependenc)|(?:Pre-?Depends|Depends):/i.test(diagnostic)
  )
    return issue("package-database-unhealthy", {
      tool: "apt-get -s check",
      expected: "consistent installed package dependencies",
      actual: {
        code: result.code,
        stdout: result.stdout.slice(0, 4096),
        stderr: result.stderr.slice(0, 4096),
      },
      recovery:
        "Review the unsatisfied dependencies and explicitly repair the installed package state; this check does not change packages, caches or configuration.",
    });
  throw new Fault(`package-dependency-check: exit ${result.code}: ${diagnostic.slice(0, 2048)}`);
}
export async function system(subject, context) {
  const problems = await directoryProblems(subject, true);
  if (problems.length) return envelope(problems);
  for (const path of new Set(directories.map((key) => subject[key]))) {
    const fs = await statfs(path, { bigint: true });
    problems.push(
      ...capacityProblems(Number(fs.bavail * fs.bsize), Number(fs.ffree), subject.policy, path),
    );
  }
  const unsupported = await packageManager(context);
  if (unsupported) problems.push(unsupported);
  else {
    const audit = await execute("dpkg", ["--audit"], context);
    if (audit.missing) throw new Fault("package-audit: dpkg missing.");
    if (audit.code !== 0 || audit.stdout.trim() || audit.stderr.trim())
      problems.push(
        issue("package-database-unhealthy", {
          tool: "dpkg --audit",
          actual: audit.stdout + audit.stderr,
          code: audit.code,
        }),
      );
    else {
      const dependencies = await execute(
        "apt-get",
        [
          "-s",
          "-o",
          "Debug::NoLocking=1",
          "-o",
          "Dir::Cache::pkgcache=",
          "-o",
          "Dir::Cache::srcpkgcache=",
          "check",
        ],
        context,
      );
      const dependencyProblem = packageDependencyProblem(dependencies);
      if (dependencyProblem) problems.push(dependencyProblem);
    }
  }
  for (const host of subject.network?.dns ?? []) {
    const code = "import{lookup}from'node:dns/promises';await lookup(process.argv[1]);";
    const result = await execute(
      process.execPath,
      ["--input-type=module", "-e", code, host],
      context,
    );
    if (result.code !== 0)
      problems.push(
        issue("dns-unavailable", {
          host,
          expected: "resolvable",
          actual: result.stderr.slice(0, 2048),
        }),
      );
  }
  for (const url of subject.network?.urls ?? []) {
    const code =
      "const r=await fetch(process.argv[1],{signal:AbortSignal.timeout(4000),redirect:'error'});await r.body?.cancel();if(!r.ok)throw Error('HTTP '+r.status);";
    const result = await execute(
      process.execPath,
      ["--input-type=module", "-e", code, url],
      context,
    );
    if (result.code !== 0)
      problems.push(
        issue("http-unavailable", {
          url,
          expected: "HTTP 2xx without redirect",
          actual: result.stderr.slice(0, 2048),
        }),
      );
  }
  return envelope(problems, [
    ...(!subject.network?.dns.length ? ["DNS: not applicable (no declared endpoints)"] : []),
    ...(!subject.network?.urls.length ? ["HTTP: not applicable (no declared endpoints)"] : []),
  ]);
}
