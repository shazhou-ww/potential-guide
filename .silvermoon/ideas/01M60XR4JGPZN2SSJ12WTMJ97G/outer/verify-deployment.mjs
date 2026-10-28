import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const outer = dirname(fileURLToPath(import.meta.url));
const repository = resolve(outer, "../../../..");
const invocation = randomUUID();
const external = join(dirname(repository), `potential-guide-host-v2-consumer-${invocation}`);
const marker = `host-v2:${invocation}`;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const within = (parent, path) => {
  const child = relative(parent, path);
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
};
const environment = { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" };
const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
async function command(program, args, cwd = repository, env = {}) {
  return execute(program, args, { cwd, windowsHide: true, timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024, env: { ...environment, ...env } });
}
async function ps(script, input, cwd = repository) {
  const child = execFile(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
    cwd, windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024, env: environment,
  });
  child.stdin.end(JSON.stringify(input));
  return new Promise((resolve, reject) => {
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += bytes; });
    child.stderr.on("data", bytes => { stderr += bytes; });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve({ stdout, stderr }) :
      reject(new Error(`Owned command exited ${code}: ${stdout}\n${stderr}`)));
  });
}
const pnpm = (args, cwd = repository) => ps(
  "$ErrorActionPreference='Stop';$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;Set-Location -LiteralPath $r.cwd;$a=@($r.args|ForEach-Object{[string]$_}); & pnpm @a;exit $LASTEXITCODE",
  { cwd, args }, cwd);
const receipt = { invocation, environment: { node: process.version, platform: process.platform },
  installation: {}, tools: [], scripts: [], cleanup: {}, status: "preparing" };
let owned = false, author, authorExit, authorOutput = "", authorError = "";
try {
  assert.equal(process.platform, "win32");
  assert.ok(!within(repository, external));
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
  const head = (await command("git", ["rev-parse", "HEAD"])).stdout.trim();
  assert.equal((await command("git", ["status", "--porcelain"])).stdout.trim(), "");
  assert.equal((await command("git", ["rev-parse", "origin/main"])).stdout.trim(), head);
  const path = relative(repository, outer).split(sep).join("/");
  const inner = (await command("git", ["rev-parse", `HEAD:${path}/inner`])).stdout.trim();
  assert.equal(inner, "d1d690f76c5516b961f6247c08473699a08cdc4a");
  receipt.baseline = {
    primaryCommit: head, implementationRevision: inner,
    deploymentRevision: (await command("git", ["rev-parse", `HEAD:${path}`])).stdout.trim(),
    contractBlob: (await command("git", ["rev-parse", `HEAD:${path}/Deployment.md`])).stdout.trim(),
  };
  for (const name of ["verify-deployment.mjs", "author.mjs", "consumer.mjs", "controlled-worker.cjs", "business-worker.cjs"])
    receipt.scripts.push({ name, sha256: sha256(await readFile(join(outer, name))) });
  await pnpm(["--filter", "@potential-guide/cli-runtime", "--filter", "@potential-guide/objective-regulator", "build"]);
  assert.equal((await command("git", ["status", "--porcelain"])).stdout.trim(), "");
  await ps(String.raw`
$ErrorActionPreference='Stop'
$r=[Console]::In.ReadToEnd()|ConvertFrom-Json
if([IO.Directory]::Exists($r.path)-or[IO.File]::Exists($r.path)){throw 'Operation directory already exists'}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
foreach($trusted in @($sid.Value,'S-1-5-18','S-1-5-32-544')){
  $rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($trusted),
  [Security.AccessControl.FileSystemRights]::FullControl,
  [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
  [Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($rule)
}
[IO.DirectoryInfo]::new([string]$r.path).Create($acl)
$actual=[IO.Directory]::GetAccessControl([string]$r.path)
if(!$actual.AreAccessRulesProtected-or$actual.GetOwner([Security.Principal.SecurityIdentifier]).Value-ne$sid.Value){throw 'Operation directory is not private'}
`, { path: external });
  owned = true;
  await writeFile(join(external, ".operation-owner"), marker, { flag: "wx" });
  await mkdir(join(external, "tarballs"));
  const available = new Map();
  for (const directory of await readdir(join(repository, "packages"))) {
    const manifest = JSON.parse(await readFile(join(repository, "packages", directory, "package.json"), "utf8"));
    available.set(manifest.name, { directory, manifest });
  }
  const closure = new Map();
  function visit(name) {
    if (closure.has(name)) return;
    const entry = available.get(name);
    assert.ok(entry, `Missing internal package ${name}`);
    closure.set(name, entry);
    for (const dependency of Object.keys(entry.manifest.dependencies ?? {}))
      if (available.has(dependency)) visit(dependency);
  }
  for (const name of ["@potential-guide/check-host", "@potential-guide/check-artifacts",
    "@potential-guide/cli-runtime", "@potential-guide/objective-pilot", "@potential-guide/objective-regulator"]) visit(name);
  const dependencies = {};
  for (const [name, entry] of closure) {
    for (const lifecycle of ["prepare", "prepack", "postpack"])
      assert.equal(entry.manifest.scripts?.[lifecycle], undefined);
    const packed = JSON.parse((await pnpm(["--dir", join(repository, "packages", entry.directory),
      "pack", "--pack-destination", join(external, "tarballs"), "--json"])).stdout.trim());
    assert.ok(within(external, packed.filename));
    const bytes = await readFile(packed.filename);
    receipt.tools.push({ name, version: packed.version, filename: relative(external, packed.filename).split(sep).join("/"),
      sha256: sha256(bytes), bytes: bytes.length, files: packed.files.length });
    dependencies[name] = pathToFileURL(packed.filename).href;
  }
  await writeFile(join(external, "package.json"), JSON.stringify({
    name: "independent-host-v2-consumer", private: true, type: "module", dependencies,
  }));
  await writeFile(join(external, "pnpm-workspace.yaml"), `packages: []\noverrides: ${JSON.stringify(dependencies)}\n`);
  const storePath = (await pnpm(["store", "path"])).stdout.trim();
  assert.ok(isAbsolute(storePath) && !within(repository, storePath));
  const install = await pnpm(["install", "--offline", "--ignore-scripts", "--no-frozen-lockfile",
    "--store-dir", dirname(storePath), "--reporter=append-only"], external);
  receipt.installation = { command: "pnpm install --offline --ignore-scripts --no-frozen-lockfile --store-dir <existing-store-parent> --reporter=append-only",
    exitCode: 0, stdoutSha256: sha256(install.stdout), stderrSha256: sha256(install.stderr), offline: true, scriptsIgnored: true };
  for (const name of ["author.mjs", "consumer.mjs", "controlled-worker.cjs", "business-worker.cjs"])
    await cp(join(outer, name), join(external, name));
  await writeFile(join(external, "installation.json"), JSON.stringify({ repository, names: [...closure.keys()] }));
  const openssl = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin", "openssl.exe");
  await command(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", "key.pem", "-out", "cert.pem", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], external);
  author = spawn(process.execPath, ["author.mjs"], { cwd: external, windowsHide: true, env: environment,
    stdio: ["pipe", "pipe", "pipe"] });
  authorExit = new Promise((resolve, reject) => {
    author.once("error", reject);
    author.once("exit", code => code === 0 ? resolve() : reject(new Error(`Author exited ${code}: ${authorError}`)));
  });
  author.stderr.on("data", bytes => { authorError = `${authorError}${bytes}`.slice(-8192); });
  const ready = new Promise((resolve, reject) => {
    author.stdout.on("data", bytes => {
      authorOutput += bytes;
      if (authorOutput.includes("\n")) {
        try { const message = JSON.parse(authorOutput.split("\n")[0]); assert.equal(message.ready, true); resolve(); }
        catch (error) { reject(error); }
      }
    });
  });
  let startupTimer;
  try {
    await Promise.race([ready, authorExit.then(() => { throw new Error("Author exited before ready."); }),
      new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error("Author ready timeout.")), 60_000); })]);
  } finally { clearTimeout(startupTimer); }
  const consumed = await command(process.execPath, ["consumer.mjs"], external,
    { NODE_EXTRA_CA_CERTS: join(external, "cert.pem") });
  receipt.consumer = JSON.parse(await readFile(join(external, "consumer-results.json"), "utf8"));
  receipt.consumerCommand = { command: "node consumer.mjs", exitCode: 0, stdout: consumed.stdout.trim() };
  const delivery = JSON.parse(await readFile(join(external, "delivery.json"), "utf8"));
  receipt.delivery = { origin: delivery.origin, objectiveDigest: delivery.objective.digest,
    certificateSha256: delivery.certificateSha256, checks: {} };
  for (const [name, product] of Object.entries(delivery.products))
    receipt.delivery.checks[name] = { digest: product.digest, transportDigest: product.transportDigest,
      archiveSha256: sha256(await readFile(product.archive)) };
  author.stdin.end("stop\n");
  await authorExit;
  receipt.author = JSON.parse(await readFile(join(external, "author-results.json"), "utf8"));
  assert.equal(receipt.author.serverClosed, true);
  assert.equal((await command("git", ["rev-parse", `HEAD:${path}/inner`])).stdout.trim(), inner);
  assert.equal((await command("git", ["status", "--porcelain"])).stdout.trim(), "");
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed";
  receipt.error = String(error).replaceAll(external, "<external>").replaceAll(repository, "<repository>");
} finally {
  if (author && author.exitCode === null) {
    author.stdin.end("stop\n");
    const timer = setTimeout(() => author.kill(), 10_000);
    try { await authorExit; } catch { receipt.cleanup.authorForcedOrFailed = true; }
    finally { clearTimeout(timer); }
  }
  if (owned) {
    assert.equal(await readFile(join(external, ".operation-owner"), "utf8"), marker);
    await rm(external, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await assert.rejects(lstat(external), { code: "ENOENT" });
  }
  receipt.cleanup.externalDirectoryRemoved = owned;
  receipt.cleanup.noPersistentService = !author || author.exitCode !== null || author.signalCode !== null;
}
const destination = join(repository, ".cache", "check-host-v2", `deployment-${invocation}.json`);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ evidence: destination, status: receipt.status, error: receipt.error,
  tools: receipt.tools.length, scenarios: receipt.consumer?.scenarios.length, cleanup: receipt.cleanup }, null, 2));
if (receipt.status !== "passed") process.exitCode = 1;
