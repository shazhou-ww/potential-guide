import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const outer = dirname(fileURLToPath(import.meta.url));
const repository = resolve(outer, "../../../..");
const invocation = randomUUID();
const external = join(dirname(repository), `potential-guide-objective-consumer-${invocation}`);
const author = join(repository, ".cache", `objective-delivery-author-${invocation}`);
const marker = `objective-artifacts:${invocation}`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (parent, path) => {
  const child = relative(parent, path);
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
};
async function command(program, args, cwd, environment = {}) {
  return execute(program, args, { cwd, windowsHide: true, timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "", ...environment } });
}
async function pnpm(args, cwd = repository) {
  const script = `$ErrorActionPreference='Stop'; $r=[Console]::In.ReadToEnd()|ConvertFrom-Json; Set-Location -LiteralPath $r.cwd; $parameters=@($r.args|ForEach-Object{[string]$_}); & pnpm @parameters; exit $LASTEXITCODE`;
  const child = execFile(join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { cwd, windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" } });
  child.stdin.end(JSON.stringify({ cwd, args }));
  return new Promise((done, fail) => {
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", fail);
    child.once("close", (code) => code === 0 ? done({ stdout, stderr })
      : fail(new Error(`pnpm exited ${code}: ${stdout}\n${stderr}`)));
  });
}
let owned = false;
let authorOwned = false;
let output;
try {
  assert.equal(process.platform, "win32", "This recorded verifier targets the current Windows environment.");
  assert.ok(!inside(repository, external));
  const baseline = (await command("git", ["rev-parse", "HEAD"], repository)).stdout.trim();
  const outerPath = relative(repository, outer).split(sep).join("/");
  const deploymentRevision = (await command("git", ["rev-parse", `HEAD:${outerPath}`], repository)).stdout.trim();
  const contractBlob = (await command("git", ["rev-parse", `HEAD:${outerPath}/Deployment.md`], repository)).stdout.trim();
  assert.equal((await command("git", ["status", "--porcelain"], repository)).stdout.trim(), "");
  assert.equal((await command("git", ["hash-object", join(outer, "Deployment.md")], repository)).stdout.trim(), contractBlob);
  assert.equal((await command("git", ["rev-parse", `HEAD:${outerPath}/inner`], repository)).stdout.trim(),
    "f0d95b841f1a98943ba4149e78f27250e2ac7cd7");
  await mkdir(external);
  owned = true;
  await writeFile(join(external, ".operation-owner"), marker, { flag: "wx" });
  const toolsDirectory = join(external, "tools");
  await mkdir(toolsDirectory);
  const tools = [];
  for (const workspace of ["effects", "check-host", "check-artifacts", "git-source", "pilot-protocol",
    "objective-pilot", "objective-regulator", "regulation-coordinator", "pguide-cli-core",
    "objective-declarations", "cli-runtime", "pguide-pilot", "pguide-regulate"]) {
    const packed = await pnpm(["--dir", join(repository, "packages", workspace), "pack",
      "--pack-destination", toolsDirectory, "--json"]);
    const metadata = JSON.parse(packed.stdout.trim());
    tools.push({ name: metadata.name, version: metadata.version, filename: metadata.filename,
      sha256: sha256(await readFile(metadata.filename)), files: metadata.files.length });
  }
  const { buildExample } = await import(pathToFileURL(join(repository, "packages", "cli-runtime",
    "examples", "objective-artifact", "build.mjs")).href);
  await assert.rejects(lstat(author), { code: "ENOENT" });
  authorOwned = true;
  const built = await buildExample(author);
  await cp(author, join(external, "delivery"), { recursive: true });
  const directory = join(external, "delivery", "objective");
  const { objectiveArtifactLocation, inspectObjectiveArtifact } = await import(pathToFileURL(
    join(repository, "packages", "cli-runtime", "dist", "index.js")).href);
  assert.equal((await inspectObjectiveArtifact(directory)).digest, built.digest);
  const location = objectiveArtifactLocation(directory, built.digest);
  await writeFile(join(external, "delivery.json"), JSON.stringify({
    repository, directory, digest: built.digest, location, toolNames: tools.map((tool) => tool.name),
  }));
  const dependencies = Object.fromEntries(tools.map((tool) => [tool.name, pathToFileURL(tool.filename).href]));
  await writeFile(join(external, "package.json"), JSON.stringify({
    name: "independent-objective-consumer", private: true, type: "module", dependencies,
  }));
  await writeFile(join(external, "pnpm-workspace.yaml"), `packages: []\noverrides: ${JSON.stringify(dependencies)}\n`);
  const store = (await pnpm(["config", "get", "store-dir"])).stdout.trim();
  assert.ok(isAbsolute(store), "Expected an explicit existing author store for offline installation.");
  const install = await pnpm(["install", "--offline", "--ignore-scripts", "--store-dir", store,
    "--reporter=append-only"], external);
  await cp(join(outer, "consumer.mjs"), join(external, "consumer.mjs"));
  const consumed = await command(process.execPath, ["consumer.mjs"], external);
  const result = JSON.parse(await readFile(join(external, "consumer-results.json"), "utf8"));
  assert.equal(result.scenarios.length, 15);
  assert.equal(result.cleanup.serverClosed, true);
  output = { baseline: { primaryCommit: baseline, deploymentRevision, contractBlob },
    invocation, externalDirectory: external, tools,
    delivery: { digest: built.digest, location }, install,
    consumerCommand: { command: "node consumer.mjs", cwd: external, ...consumed }, result };
} finally {
  if (authorOwned) await rm(author, { recursive: true, force: true });
  if (owned) {
    assert.equal(await readFile(join(external, ".operation-owner"), "utf8"), marker);
    await rm(external, { recursive: true, force: true });
  }
}
assert.ok(output, "Independent consumer verification did not finish.");
await assert.rejects(lstat(external), { code: "ENOENT" });
output.cleanup = { ...output.result.cleanup, externalDirectoryRemoved: true, authorOutputRemoved: true };
const destination = process.argv[2] ? resolve(repository, process.argv[2])
  : join(repository, ".cache", `objective-consumer-${invocation}.json`);
assert.ok(inside(join(repository, ".cache"), destination)
  || (inside(outer, destination) && !inside(join(outer, "inner"), destination)));
assert.ok(destination.endsWith(".json"));
await writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ evidence: destination, deploymentRevision: output.baseline.deploymentRevision,
  digest: output.delivery.digest, scenarios: output.result.scenarios.length,
  executions: output.result.diagnostics.executions, cleanup: output.cleanup }, null, 2));
