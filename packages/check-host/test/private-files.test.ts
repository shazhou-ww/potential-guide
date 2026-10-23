import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, lstat, mkdir, readdir, readFile, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  closePrivateFileBackend,
  connectHost,
  createPrivateDirectory,
  createPrivateFile,
  ensurePrivateDirectory,
  privateFileProof,
  publishPrivateFile,
  readPrivateFile,
  removePrivateFile,
} from "../dist/index.js";

const execute = promisify(execFile);
const aclCommand = String.raw`
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Import-Module -Name ($PSHOME+'\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$request=Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
if($request.directory){$acl=[IO.Directory]::GetAccessControl($request.path)}
else{$acl=[IO.File]::GetAccessControl($request.path)}
if($request.broaden){
  $rule=[Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.SecurityIdentifier]::new([string]$request.broaden),
    [Security.AccessControl.FileSystemRights]::Modify,
    [Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($rule)
  if($request.directory){[IO.Directory]::SetAccessControl($request.path,$acl)}
  else{[IO.File]::SetAccessControl($request.path,$acl)}
}
$value=@{
  owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  protected=$acl.AreAccessRulesProtected
  allowed=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object {$_.IdentityReference.Value})
}
[Console]::Out.WriteLine((Microsoft.PowerShell.Utility\ConvertTo-Json -Compress -InputObject $value))
`;
async function acl(
  root: string,
  path: string,
  directory: boolean,
  broaden: string | false = false,
) {
  const system = process.env.SystemRoot;
  assert.ok(system);
  const pending = execute(
    join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(aclCommand, "utf16le").toString("base64"),
    ],
    {
      shell: false,
      windowsHide: true,
      timeout: 15_000,
      env: { ...process.env, TEMP: root, TMP: root, PSModulePath: "" },
    },
  );
  pending.child.stdin?.end(JSON.stringify({ path, directory, broaden }));
  return JSON.parse((await pending).stdout) as {
    owner: string;
    protected: boolean;
    allowed: string[];
  };
}
async function fixture() {
  return createPrivateDirectory(resolve(".cache", "check-host-tests"), "private-files-");
}

test("directory and file privacy are proven by real native ACLs or actual POSIX owner/mode", async () => {
  const root = await fixture();
  try {
    await createPrivateFile(root, "host.json", "non-secret fixture");
    const proof = await privateFileProof(root, "host.json");
    assert.equal(proof.owner, proof.currentUser);
    assert.ok(proof.protected);
    if (process.platform === "win32") {
      const trusted = [proof.currentUser, "S-1-5-18", "S-1-5-32-544"].sort();
      for (const [path, directory] of [
        [root, true],
        [join(root, "host.json"), false],
      ] as const) {
        const actual = await acl(root, path, directory);
        assert.equal(actual.owner, proof.currentUser);
        assert.equal(actual.protected, true);
        assert.deepEqual(actual.allowed.sort(), trusted);
      }
      assert.deepEqual(proof.allowed.sort(), trusted);
    } else {
      assert.equal((await lstat(root)).mode & 0o777, 0o700);
      assert.equal((await lstat(join(root, "host.json"))).mode & 0o777, 0o600);
      assert.equal((await lstat(root)).uid, process.getuid?.());
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("broad legacy directory is rejected without rewriting its ACL or creating credentials", async () => {
  const root = await fixture();
  const legacy = join(root, "legacy");
  await mkdir(legacy, { mode: 0o700 });
  try {
    if (process.platform === "win32") {
      const broad = await acl(root, legacy, true, "S-1-1-0");
      assert.ok(broad.allowed.includes("S-1-1-0"));
    } else await chmod(legacy, 0o777);
    await assert.rejects(ensurePrivateDirectory(legacy), { code: "EPRIVATE" });
    await assert.rejects(createPrivateFile(legacy, "host.json", "must-not-be-written"), {
      code: "EPRIVATE",
    });
    assert.deepEqual(await readdir(legacy), []);
    if (process.platform === "win32")
      assert.ok((await acl(root, legacy, true)).allowed.includes("S-1-1-0"));
    else assert.equal((await lstat(legacy)).mode & 0o777, 0o777);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("broad descriptor, startup, store mutex and legacy publication files fail closed before HTTP", async (t) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) => {
    requests++;
    return originalFetch(...args);
  });
  try {
    for (const name of [
      "host.json",
      "startup.json",
      "private-store.lock",
      "legacy-publication.json",
    ]) {
      const root = await fixture();
      const content = "non-secret-credential-fixture-must-not-be-echoed";
      try {
        if (name === "private-store.lock") {
          await createPrivateFile(root, "fixture.json", "fixture");
          if (process.platform !== "win32") await createPrivateFile(root, name, "");
        } else await createPrivateFile(root, name, content);
        if (process.platform === "win32") await acl(root, join(root, name), false, "S-1-1-0");
        else await chmod(join(root, name), 0o644);
        const error = await connectHost(root).then(
          () => undefined,
          (value: unknown) => value,
        );
        assert.ok(error instanceof Error);
        assert.equal((error as NodeJS.ErrnoException).code, "EPRIVATE");
        assert.ok(!error.message.includes(content));
        if (name !== "private-store.lock")
          assert.equal(await readFile(join(root, name), "utf8"), content);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
    assert.equal(requests, 0);
  } finally {
    t.mock.restoreAll();
  }
});

test("private publication uses guarded expected-content transitions and preserves old data on failure", async () => {
  const root = await fixture();
  try {
    assert.equal(await publishPrivateFile(root, "host.json", "first", null), true);
    assert.equal(await publishPrivateFile(root, "host.json", "not-written", null), false);
    assert.equal(await publishPrivateFile(root, "host.json", "not-written", "wrong"), false);
    assert.equal(await readPrivateFile(root, "host.json"), "first");
    assert.equal(await publishPrivateFile(root, "host.json", "second", "first"), true);
    assert.equal(await removePrivateFile(root, "host.json", "first"), false);
    assert.equal(await readPrivateFile(root, "host.json"), "second");
    if (process.platform === "win32") {
      await chmod(join(root, "host.json"), 0o400);
      await assert.rejects(publishPrivateFile(root, "host.json", "must-not-replace", "second"));
      assert.equal(await readPrivateFile(root, "host.json"), "second");
      assert.deepEqual(
        (await readdir(root)).filter((name) => name.startsWith("publication-")),
        [],
      );
      await chmod(join(root, "host.json"), 0o600);
    }
    assert.equal(await removePrivateFile(root, "host.json", "second"), true);
  } finally {
    await chmod(join(root, "host.json"), 0o600).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("ordinary Windows group grants are refused for directories and metadata", async (t) => {
  if (process.platform !== "win32") return t.skip("Windows ACL identities only");
  for (const sid of ["S-1-5-11", "S-1-5-32-545", "S-1-1-0"]) {
    for (const directory of [true, false]) {
      const root = await fixture();
      try {
        if (!directory) await createPrivateFile(root, "host.json", "non-secret fixture");
        const path = directory ? root : join(root, "host.json");
        await acl(root, path, directory, sid);
        await assert.rejects(ensurePrivateDirectory(root), { code: "EPRIVATE" });
        assert.ok((await acl(root, path, directory)).allowed.includes(sid));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }
});

test("independent Windows publishers compare and replace exactly one reservation", async (t) => {
  if (process.platform !== "win32") return t.skip("Windows native store mutex only");
  const root = await fixture();
  try {
    await createPrivateFile(root, "startup.json", "before");
    const script = `const security=await import(process.argv[1]);
      try {
        const replaced=await security.publishPrivateFile(process.argv[2],"startup.json",process.argv[3],"before");
        console.log(JSON.stringify({replaced}));
      } finally {await security.closePrivateFileBackend()}`;
    const entry = new URL("../dist/private-files.js", import.meta.url).href;
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, n) =>
        execute(
          process.execPath,
          ["--input-type=module", "-e", script, entry, root, `after-${n}`],
          {
            shell: false,
            windowsHide: true,
            timeout: 25_000,
            env: { ...process.env, TEMP: root, TMP: root },
          },
        ),
      ),
    );
    const replaced = results.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return (JSON.parse(result.value.stdout) as { replaced: boolean }).replaced;
    });
    assert.equal(replaced.filter(Boolean).length, 1);
    assert.equal(await readPrivateFile(root, "startup.json"), `after-${replaced.indexOf(true)}`);
    assert.equal(await removePrivateFile(root, "startup.json", "before"), false);
    assert.equal((await privateFileProof(root, "startup.json")).protected, true);
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.startsWith("publication-")),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("path strings are data, aliases are refused, and permission backend failure has no fallback", async () => {
  const root = await fixture();
  let privateRoot: string | undefined;
  try {
    const parent = join(root, "space & 'quoted' 中文");
    await mkdir(parent);
    privateRoot = await createPrivateDirectory(parent, "host-");
    await createPrivateFile(privateRoot, "host.json", "fixture");
    assert.equal(await readPrivateFile(privateRoot, "host.json"), "fixture");
    const alias = join(root, "alias");
    await symlink(privateRoot, alias, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(ensurePrivateDirectory(alias), { code: "EPRIVATE" });
    if (process.platform === "win32") {
      const target = join(root, "backend-must-not-create");
      const script = `import assert from "node:assert/strict";
        import cp from "node:child_process";import {syncBuiltinESMExports} from "node:module";
        cp.spawn=()=>{throw Object.assign(new Error("Injected private-file backend failure"),{code:"EACCES"})};
        syncBuiltinESMExports();
        const security=await import(process.argv[1]);
        await assert.rejects(security.ensurePrivateDirectory(process.argv[2]),{code:"EPRIVATE"});`;
      const entry = new URL("../dist/private-files.js", import.meta.url).href;
      await execute(process.execPath, ["--input-type=module", "-e", script, entry, target], {
        shell: false,
        windowsHide: true,
        timeout: 10_000,
        env: {
          ...process.env,
          TEMP: root,
          TMP: root,
        },
      });

      await assert.rejects(lstat(target), { code: "ENOENT" });
    } else {
      await chmod(privateRoot, 0o500);
      await assert.rejects(ensurePrivateDirectory(privateRoot), { code: "EPRIVATE" });
      await chmod(privateRoot, 0o700);
    }
  } finally {
    if (privateRoot) await chmod(privateRoot, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("an owned permission helper exits after its client is forcibly terminated", async (t) => {
  if (process.platform !== "win32") return t.skip("Windows permission helper only");
  const root = await fixture();
  const journal = join(root, "backend-started.jsonl");
  const script = `import cp from "node:child_process";
    import {writeFileSync} from "node:fs";import {syncBuiltinESMExports} from "node:module";
    const spawn=cp.spawn;
    cp.spawn=(program,args,options)=>{
      const child=spawn(program,args,options);
      child.once("spawn",()=>writeFileSync(process.argv[3],JSON.stringify({pid:child.pid,parent:process.pid,program,root:process.argv[2]}),{flag:"wx"}));
      return child;
    };syncBuiltinESMExports();
    const security=await import(process.argv[1]);
    await security.ensurePrivateDirectory(process.argv[2]);
    console.log("ready");setInterval(()=>{},1000);`;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      script,
      new URL("../dist/private-files.js", import.meta.url).href,
      root,
      journal,
    ],
    {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let backend: number | undefined;
  const closed = new Promise<void>((done) => child.once("close", () => done()));
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Owned permission backend did not become ready.")),
        15_000,
      );
      child.stdout.once("data", () => {
        clearTimeout(timer);
        done();
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const entry = JSON.parse(await readFile(journal, "utf8")) as {
      pid: number;
      parent: number;
      program: string;
      root: string;
    };
    assert.equal(entry.parent, child.pid);
    assert.equal(entry.root, root);
    assert.equal(
      entry.program.toLowerCase(),
      join(
        process.env.SystemRoot ?? "",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ).toLowerCase(),
    );
    assert.ok(Number.isSafeInteger(entry.pid) && entry.pid > 0 && entry.pid !== process.pid);
    backend = entry.pid;
    child.kill("SIGKILL");
    await closed;
    const end = Date.now() + 5000;
    while (true) {
      try {
        process.kill(backend, 0);
      } catch {
        backend = undefined;
        break;
      }
      assert.ok(Date.now() < end, "Owned permission helper did not exit on client pipe closure.");
      await new Promise((done) => setTimeout(done, 20));
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
    if (backend !== undefined) {
      try {
        process.kill(backend, "SIGKILL");
      } catch {}
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("permission backend normal shutdown is explicit and leaves subsequent validation usable", async () => {
  const root = await fixture();
  try {
    await closePrivateFileBackend();
    const listeners = process.listenerCount("exit");
    await ensurePrivateDirectory(root);
    await createPrivateFile(root, "proof.json", "fixture");
    await closePrivateFileBackend();
    assert.equal(await readPrivateFile(root, "proof.json"), "fixture");
    await closePrivateFileBackend();
    assert.equal(process.listenerCount("exit"), listeners);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
