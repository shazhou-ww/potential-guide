import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Effect } from "@potential-guide/effects";
import { withPilot } from "@potential-guide/cli-runtime";
import { observe, readPage } from "@potential-guide/objective-pilot";
import {
  CheckClient, CheckKernel, closePrivateFileBackend, ensurePrivateDirectory,
  publishPrivateFile, removePrivateFile, serve,
} from "@potential-guide/check-host";

const root = process.cwd();
const delivery = JSON.parse(await readFile("delivery.json", "utf8"));
const execute = promisify(execFile);
const within = (parent, path) => {
  const child = relative(parent, path);
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
};
const result = { environment: { node: process.version, platform: process.platform },
  root, modules: [], scenarios: [], sources: undefined };
assert.equal(process.env.NODE_PATH, "");
assert.equal(process.env.NODE_OPTIONS, "");
for (const name of delivery.toolNames) {
  const path = await realpath(fileURLToPath(import.meta.resolve(name)));
  assert.ok(within(root, path));
  assert.ok(!within(delivery.repository, path));
  result.modules.push({ name, path });
}
const hostDirectory = resolve("private-host");
await ensurePrivateDirectory(hostDirectory);
const kernel = await CheckKernel.create(join(hostDirectory, "snapshots"));
const token = randomUUID();
const host = await serve(kernel, token);
const descriptor = JSON.stringify({
  endpoint: host.endpoint, token, pid: process.pid, instance: randomUUID(),
});
let published = false;
try {
  assert.equal(await publishPrivateFile(hostDirectory, "host.json", descriptor, null), true);
  published = true;
  process.env.PGUIDE_CHECK_HOST_DIRECTORY = hostDirectory;
  const response = await fetch(`${host.endpoint}/checks`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(2000),
  });
  assert.equal(response.status, 200);
  await response.body.cancel();
  const address = JSON.parse(descriptor);
  assert.ok(new CheckClient(address));
  const options = { cacheDirectory: hostDirectory, reports: { enabled: false } };
  await withPilot(delivery.location, root, undefined, async (spec, runtime) => {
    result.sources = Object.fromEntries(
      runtime.boundObjectives().map((bound) => [bound.objectiveId, bound.source]),
    );
    assert.equal(spec.source.checks.first.digest, spec.source.checks.second.digest);
    for (const [subject, expected, problemKind] of [
      [{ first: false, second: true, dependencyReady: true }, "initial", "internal"],
      [{ first: true, second: false, dependencyReady: true }, "ready", "internal"],
      [{ first: true, second: true, dependencyReady: false }, "ready", "dependency"],
      [{ first: true, second: true, dependencyReady: true }, "complete", undefined],
    ]) {
      const observed = await Effect.runPromise(observe({ spec, subject, language: "zh-CN" }, runtime));
      assert.equal(observed.status, 200, observed.message);
      assert.equal(observed.payload.current.levelId, expected);
      assert.equal(observed.payload.problems[0]?.kind, problemKind);
      result.scenarios.push({ label: `api-${expected}-${problemKind ?? "passed"}`, subject, observed });
    }
    const before = kernel.diagnostics().executions;
    await Effect.runPromise(observe({
      spec, subject: { first: false, second: false, dependencyReady: false }, targetLevel: "initial",
    }, runtime));
    assert.equal(kernel.diagnostics().executions, before);
    result.scenarios.push({ label: "initial-target-no-execution", executions: before });
    const inherited = readPage(spec, "checks/first/problems/not-ready", "zh-CN");
    const overridden = readPage(spec, "levels/complete/checks/second/problems/not-ready", "zh-CN");
    const base = readPage(spec, "pages/base-second-not-ready", "zh-CN");
    assert.match(inherited.content, /Uncovered references/);
    assert.equal(overridden.title, "第二输入场景");
    assert.deepEqual(overridden.references, ["pages/base-second-not-ready"]);
    assert.equal(base.origin.artifactDigest, spec.source.checks.second.digest);
    assert.equal(overridden.origin.artifactDigest, delivery.digest);
    assert.notEqual(base.resourceBase, overridden.resourceBase);
    result.scenarios.push({ label: "scoped-references", inherited, overridden, base });
  }, options);
  const recovery = { ...options, sources: result.sources };
  const secondCache = resolve("second-cache");
  await withPilot("objective:composition", root, undefined, async () => {}, {
    ...recovery, cacheDirectory: secondCache,
  });
  const stateDirectory = resolve("state");
  await mkdir(".pguide");
  await writeFile(".pguide/config.jsonc", JSON.stringify({
    "cli-core.stateDirectory": stateDirectory, "agents.defaultAgent": "never",
    "pilot.reportsEnabled": false,
  }));
  await writeFile(".pguide/agents.yaml", JSON.stringify({
    $schema: "https://shazhou-ww.github.io/potential-guide/schemas/agents/v1.json",
    agents: { never: {
      type: "acp", connection: { protocolVersion: "1" },
      transport: { type: "stdio", command: process.execPath,
        args: ["-e", "throw Error('An already-satisfied target must not call an Agent')"] },
    } },
  }));
  await writeFile("objectives.yaml", JSON.stringify({
    $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json",
    objectives: { composite: { description: "Independent composition",
      objective: delivery.location, inputSchema: { type: "object" }, subject: "input" } },
  }));
  const input = resolve("input.json");
  const subject = { first: true, second: false, dependencyReady: true };
  await writeFile(input, JSON.stringify(subject));
  async function cli(command, args, format = "json") {
    const packageName = ["regulate", "continue"].includes(command)
      ? "@potential-guide/pguide-regulate" : "@potential-guide/pguide-pilot";
    const bin = join(dirname(fileURLToPath(import.meta.resolve(packageName))), "bin", `${command}.js`);
    const { stdout } = await execute(process.execPath, [
      bin, ...args, "--cwd", root, "--format", format,
    ], { cwd: root, timeout: 30_000, windowsHide: true,
      env: { ...process.env, APPDATA: resolve("user-config"), XDG_CONFIG_HOME: resolve("user-config"),
        HOME: resolve("user-home"), NODE_PATH: "", NODE_OPTIONS: "" } });
    return format === "json" ? JSON.parse(stdout) : stdout;
  }
  const validated = await cli("validate", ["artifact", delivery.directory]);
  assert.equal(validated.artifactDigest, delivery.digest);
  result.scenarios.push({ label: "cli-validate", validated });
  const observed = await cli("probe", ["--objective", "composite", "--scope", "directory",
    "--input-file", input]);
  assert.equal(observed.payload.current.levelId, "ready");
  result.scenarios.push({ label: "cli-declaration", observed });
  const guidance = await cli("probe", ["--pilot", delivery.location, "--subject-file", input,
    "--language", "zh-CN"], "markdown");
  assert.match(guidance, /第二输入场景/);
  result.scenarios.push({ label: "cli-guidance", guidance });
  await writeFile(input, JSON.stringify({ ...subject, second: true }));
  const regulated = await cli("regulate", ["--pilot", delivery.location, "--subject-file", input,
    "--target", "terminal"]);
  assert.equal(regulated.status, "target-reached");
  assert.equal(regulated.outcome.iterations, 0);
  const persisted = JSON.parse(await readFile(
    join(stateDirectory, "regulations", regulated.regulationId, "regulation.json"), "utf8"));
  assert.equal(persisted.schemaVersion, 6);
  assert.equal(persisted.objectiveArtifactDigest, delivery.digest);
  result.scenarios.push({ label: "cli-regulate-no-agent", regulated, persisted });
  await rm(resolve("delivery"), { recursive: true, force: true });
  const resumed = await cli("continue", [regulated.regulationId]);
  assert.equal(resumed.status, "target-reached");
  assert.deepEqual(resumed.outcome.latestObservation.payload.sources["objective:composition"],
    persisted.objectiveSource);
  result.scenarios.push({ label: "continue-after-source-removal", resumed });
  await withPilot("objective:composition", root, undefined, async (spec) => {
    assert.deepEqual(spec.source, result.sources["objective:composition"]);
  }, recovery);
  result.scenarios.push({ label: "api-offline-recovery", sameSource: true });
  const before = kernel.diagnostics().executions;
  await assert.rejects(withPilot("objective:composition", root, undefined, async () => {}, {
    ...recovery, cacheDirectory: resolve("missing-cache"),
  }), /ENOENT/);
  result.scenarios.push({ label: "missing-source-fails", executions: before });
  const firstDigest = result.sources["objective:composition"].checks.first.digest.split(":")[1];
  await rm(join(secondCache, "objective-artifacts", "checks", firstDigest, "execution", "worker.cjs"));
  await assert.rejects(withPilot("objective:composition", root, undefined, async () => {}, {
    ...recovery, cacheDirectory: secondCache,
  }));
  result.scenarios.push({ label: "missing-check-fails", executions: before });
  const page = join(hostDirectory, "objective-artifacts", "objectives",
    delivery.digest.split(":")[1], "references", "overview.md");
  await chmod(page, 0o600);
  await writeFile(page, "# Tampered content\n");
  await assert.rejects(withPilot("objective:composition", root, undefined, async () => {}, recovery),
    /digest mismatch/);
  assert.equal(kernel.diagnostics().executions, before);
  result.scenarios.push({ label: "tampered-reference-fails", executions: before });
  result.diagnostics = kernel.diagnostics();
} finally {
  try {
    await host.close();
    if (published) await removePrivateFile(hostDirectory, "host.json", descriptor);
  } finally {
    await closePrivateFileBackend();
  }
}
result.cleanup = { serverClosed: !host.server.listening, kernelClosed: true, permissionHelperClosed: true };
await writeFile("consumer-results.json", `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ passed: true, scenarios: result.scenarios.length,
  executions: result.diagnostics.executions, cleanup: result.cleanup }));
