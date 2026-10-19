import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = dirname(fileURLToPath(import.meta.url));
const checker = join(base, "outer-checker");
const target = join(base, "outer-target");
const example = join(base, "outer-browser-worker");
const evidence = join(base, "outer-results");
const revision = "65c14f1dff3e169c917d2cf67c093d2a16e59df4";
const deploymentRevision = "71dd6bff6dfb369a0c155ac15d109fb7def2f595";
await mkdir(evidence, { recursive: true });
const commands = [];
function run(command, args, cwd = checker) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
  commands.push({ command, args, cwd, exitCode: result.status });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
async function write(root, path, value) {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}
async function hash(root) {
  const entries = [];
  async function visit(directory, relative = "") {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".git") continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(join(directory, entry.name), path);
      else {
        assert.equal(entry.isSymbolicLink(), false);
        entries.push([path, createHash("sha256").update(await readFile(join(directory, entry.name))).digest("hex")]);
      }
    }
  }
  await visit(root);
  return { files: entries.length, sha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex") };
}
assert.equal(run("git", ["rev-parse", "HEAD"], checker), revision);
assert.equal(run("git", ["rev-parse", "HEAD"], target), revision);
assert.equal(run("git", ["status", "--porcelain"], checker), "");
assert.equal(run("git", ["status", "--porcelain"], target), "");
// Artifacts come from the separately built trusted checkout of the identical source revision.
for (const directory of await readdir(join(checker, "packages"))) {
  await cp(join(checker, "packages", directory, "dist"), join(target, "packages", directory, "dist"), { recursive: true });
}
const module = join(checker, "packages", "monorepo-objective", "dist", "index.js");
const cli = join(checker, "packages", "pguide", "dist", "bin.js");
const manifest = join(checker, "objectives", "pnpm-monorepo", "pilot.yaml");
const commandDirectory = join(base, "outer-commands");
await mkdir(commandDirectory, { recursive: true });
await write(commandDirectory, "pguide-probe.cmd", `@echo off\r\n"${process.execPath}" "${join(checker, "packages", "pguide", "dist", "bin", "probe.js")}" %*\r\n`);
const config = join(base, "outer-cli-config.json");
await write(base, "outer-cli-config.json", { schemaVersion: 2, commandDirectories: [commandDirectory], stateDirectory: join(base, "outer-state") });
const results = [];
async function observe(name, root, contract, expected, requiredRule) {
  const subjectPath = join(base, `${name}-subject.json`);
  await write(base, `${name}-subject.json`, { root, contract, checkerModule: module });
  const before = await hash(root);
  const beforeStatus = run("git", ["status", "--porcelain", "--untracked-files=all"], root);
  const direct = JSON.parse(run(process.execPath, [join(checker, "objectives", "pnpm-monorepo", "check.mjs"), "deliveries", "--subject-file", subjectPath]));
  assert.equal(direct.status, 200);
  const report = JSON.parse(direct.message);
  assert.equal(report.state, expected, JSON.stringify(report.findings.filter((finding) => finding.state !== "pass")));
  if (requiredRule) assert.ok(report.findings.some((finding) => finding.rule === requiredRule && finding.state !== "pass"));
  const output = JSON.parse(run(process.execPath, [cli, "probe", "--config", config, "--pilot", manifest, "--revision", revision, "--subject-file", subjectPath, "--format", "json"]));
  assert.equal(output.status, 200, JSON.stringify(output));
  const expectedLevel = expected === "pass" ? "terminal" : report.layer2 === "blocked" ? "initial" : "structured";
  assert.equal(output.payload.current.levelId, expectedLevel);
  assert.ok(Object.values(output.payload.versions).every((value) => value === revision));
  assert.equal(report.onlineVerified, false);
  const after = await hash(root);
  const afterStatus = run("git", ["status", "--porcelain", "--untracked-files=all"], root);
  assert.deepEqual(after, before);
  assert.equal(afterStatus, beforeStatus);
  await write(evidence, `${name}-report.json`, report);
  await write(evidence, `${name}-pilot.json`, output);
  results.push({ name, state: report.state, level: output.payload.current.levelId, before, after, beforeStatus, afterStatus, requiredRule: requiredRule ?? null, subject: { root, contract, checkerModule: module } });
}
await observe("repository", target, "objectives/pnpm-monorepo/examples/repository.json", "pass");

await mkdir(example, { recursive: true });
run("git", ["init", "--quiet"], example);
const internal = { name: "shared", path: "packages/shared", roles: ["internal"], runtime: "universal", allows: [], entries: ["src/index.ts"], sources: ["src/index.ts"], tasks: ["build", "test", "typecheck"] };
const app = { name: "app", path: "apps/app", roles: ["browser", "cloudflare-worker"], runtime: "universal", allows: ["shared"], entries: ["src/browser.ts", "src/worker.ts"], sources: ["src/browser.ts", "src/worker.ts"], tasks: ["build", "test", "typecheck"] };
const browser = { id: "web-preview", purpose: "Isolated browser delivery", kind: "browser", packages: ["app", "shared"], entry: { package: "app", path: "src/browser.ts" }, runtime: "browser", environment: "preview", config: "apps/app/site.json", output: "apps/app/dist", resources: [], services: ["app"], capabilities: [], independent: false };
const worker = { ...browser, id: "api-preview", purpose: "Isolated Worker delivery", kind: "cloudflare-worker", entry: { package: "app", path: "src/worker.ts" }, runtime: "worker", config: "apps/app/wrangler.json", services: [], resources: [{ name: "DB", kind: "resource", visibility: "server", supply: "platform", environment: "preview" }] };
const requirements = { schemaVersion: 1, policy: { source: "pnpm-default-v1", directories: { apps: "apps", packages: "packages", docs: "docs", scripts: "scripts" }, requiredFiles: [], exceptions: [], assignments: [], allowedDirectories: [], dependencyExceptions: [] }, workspaces: [internal, app], deliveries: [browser, worker] };
await write(example, "requirements.json", requirements);
await write(example, "README.md", "# Isolated deployment target\n");
await write(example, "package.json", { name: "isolated-target", private: true });
await write(example, "pnpm-workspace.yaml", "packages: [apps/*, packages/*]\n");
await write(example, "turbo.json", { tasks: { build: { outputs: ["dist/**"], dependsOn: ["^build"] }, test: { outputs: [] }, typecheck: { outputs: [] } } });
for (const workspace of [internal, app]) {
  await write(example, `${workspace.path}/README.md`, `# ${workspace.name}\n`);
  await write(example, `${workspace.path}/package.json`, { name: workspace.name, private: true, exports: { ".": "./src/index.ts" }, scripts: { build: "MUST_NOT_EXECUTE", test: "MUST_NOT_EXECUTE", typecheck: "MUST_NOT_EXECUTE" }, ...(workspace.name === "app" ? { dependencies: { shared: "workspace:^" } } : {}) });
}
await write(example, "packages/shared/src/index.ts", "export const value = 1;\n");
await write(example, "apps/app/src/browser.ts", "import { value } from 'shared'; console.log(value);\n");
await write(example, "apps/app/src/worker.ts", "import { value } from 'shared'; export default { fetch: () => new Response(String(value)) };\n");
await write(example, "apps/app/dist/site.js", "console.log('prebuilt non-secret isolated artifact');\n");
await write(example, "apps/app/site.json", { entry: "apps/app/src/browser.ts", environment: "preview", outputDirectory: "apps/app/dist" });
const wrangler = { name: "isolated-preview", main: "src/worker.ts", compatibility_date: "2026-01-01", env: { preview: { d1_databases: [{ binding: "DB", database_id: "isolated-non-provisioned-reference" }] } } };
await write(example, "apps/app/wrangler.json", wrangler);
run("git", ["add", "."], example);
run("git", ["-c", "user.name=Deployment Validation", "-c", "user.email=validation@example.invalid", "commit", "--quiet", "-m", "Record isolated browser and Worker validation target"], example);
const fixtureCommit = run("git", ["rev-parse", "HEAD"], example);
await observe("isolated-pass", example, "requirements.json", "pass");

await write(example, "service-guide.md", "# Isolated service operations guide\n");
requirements.policy.assignments.push({ path: "service-guide.md", purpose: "package-doc", owner: "app", reason: "Confirmed application-owned guide" });
await write(example, "requirements.json", requirements);
await observe("structure-fail", example, "requirements.json", "fail", "file-responsibility");
await mkdir(join(example, "apps", "app", "docs"), { recursive: true });
await cp(join(example, "service-guide.md"), join(example, "apps", "app", "docs", "service-guide.md"));
const { unlink } = await import("node:fs/promises");
await unlink(join(example, "service-guide.md"));
requirements.policy.assignments[0].path = "apps/app/docs/service-guide.md";
await write(example, "requirements.json", requirements);
await observe("structure-repaired", example, "requirements.json", "pass");

app.allows = [];
await write(example, "requirements.json", requirements);
await observe("dependency-fail", example, "requirements.json", "fail", "dependency-direction");
app.allows = ["shared"];
await write(example, "requirements.json", requirements);
await observe("dependency-repaired", example, "requirements.json", "pass");

await write(example, "apps/app/site.json", { entry: "apps/app/src/browser.ts", environment: "production", outputDirectory: "apps/app/wrong-output" });
await observe("browser-config-fail", example, "requirements.json", "fail", "browser-deployment");
await write(example, "apps/app/site.json", { entry: "apps/app/src/browser.ts", environment: "preview", outputDirectory: "apps/app/dist" });
await observe("browser-config-repaired", example, "requirements.json", "pass");

await write(example, "apps/app/wrangler.json", { ...wrangler, main: "src/wrong.ts", env: { preview: {} } });
await observe("worker-config-fail", example, "requirements.json", "fail", "worker-entry");
await write(example, "apps/app/wrangler.json", wrangler);
await observe("worker-config-repaired", example, "requirements.json", "pass");

worker.environment = "production";
worker.resources[0].environment = "production";
await write(example, "requirements.json", requirements);
await write(example, "apps/app/wrangler.json", { ...wrangler, env: { production: wrangler.env.preview } });
await observe("service-environment-fail", example, "requirements.json", "fail", "service-environment");
worker.environment = "preview";
worker.resources[0].environment = "preview";
await write(example, "requirements.json", requirements);
await write(example, "apps/app/wrangler.json", wrangler);
await observe("service-environment-repaired", example, "requirements.json", "pass");

await write(evidence, "validation-summary.json", { sourceRevision: revision, executedDeploymentRevision: deploymentRevision, checkerRoot: checker, targetRoot: target, isolatedRoot: example, isolatedInitialCommit: fixtureCommit, node: process.version, pguideVersion: run(process.execPath, [cli, "--version", "--format", "json"]), results, commands, onlineVerified: false, noTargetScriptsExecuted: true });
await write(evidence, "isolated-contract.json", requirements);
await write(evidence, "validation-complete.txt", `${results.length} observations passed assertions; every before/after hash and Git status unchanged by the observers.\n`);
console.log(JSON.stringify({ revision, deploymentRevision, observations: results.length, results: results.map(({ name, state, level }) => ({ name, state, level })), evidence }, null, 2));
