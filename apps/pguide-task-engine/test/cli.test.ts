import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const cli = join(root, "apps", "pguide-task-engine", "dist", "main.js");
const pguide = join(root, "packages", "pguide", "dist", "bin.js");
function capture(entry: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd, env, windowsHide: true });
    let stdout = ""; let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
  });
}
test("standalone and pguide discovery, --config, --cwd, isolation and foreground shutdown", async (t) => {
  await mkdir(join(root, ".cache"), { recursive: true });
  const directory = await mkdtemp(join(root, ".cache", "service-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const user = join(directory, "user");
  await mkdir(join(user, "pguide"), { recursive: true });
  const userFile = join(user, "pguide", "config.jsonc");
  await writeFile(userFile, "{malformed");
  const bin = join(directory, "bin");
  await mkdir(bin);
  const shim = join(bin, `pguide-task-engine${process.platform === "win32" ? ".cmd" : ""}`);
  await writeFile(shim, process.platform === "win32"
    ? `@"${process.execPath}" "${cli}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`);
  await chmod(shim, 0o755);
  const env = { ...process.env, APPDATA: user, XDG_CONFIG_HOME: user, PATH: bin + delimiter + process.env.PATH };
  await mkdir(join(directory, "work", ".pguide"), { recursive: true });
  const cwd = join(directory, "work");
  await writeFile(join(cwd, ".pguide", "config.jsonc"), '{"task-engine.port":"invalid project service setting"}');
  await writeFile(join(cwd, "server.yaml"), "port: 0\ndatabase: owned.sqlite\nipfsRpcUrl: http://127.0.0.1:1\n");
  for (const [entry, prefix] of [[cli, []], [pguide, ["task-engine"]]] as const) {
    const help = await capture(entry, [...prefix, "--no-global-config", "--help", "--format", "json"], directory, env);
    assert.equal(help.code, 0, help.stderr + help.stdout);
    assert.equal(JSON.parse(help.stdout).globalConfig, userFile);
    assert.match(help.stdout, /Project service settings are never read/);
    const invalid = await capture(entry, [...prefix, "--cwd", cwd, "--config", "server.yaml", "--port", "bad", "--no-global-config"], directory, env);
    assert.notEqual(invalid.code, 0);
    assert.doesNotMatch(invalid.stdout, /"event":"ready"/);
    const blocked = await capture(entry, [...prefix, "--cwd", cwd, "--config", "server.yaml"], directory, env);
    assert.notEqual(blocked.code, 0);
  }
  const retired = await capture(pguide, ["config", "--config", "server.yaml"], directory, env);
  assert.notEqual(retired.code, 0);
  assert.match(retired.stdout + retired.stderr, /--config is retired/);
  const module = join(cwd, "unsafe.mjs");
  const marker = join(cwd, "executed");
  await writeFile(module, `import {writeFileSync} from "node:fs";writeFileSync(${JSON.stringify(marker)},"unsafe");setInterval(()=>{},1000);`);
  const rejected = await capture(pguide, ["task-engine", "--no-global-config", "--config", module], directory, env);
  assert.notEqual(rejected.code, 0);
  assert.match(rejected.stderr + rejected.stdout, /Executable .mjs configs are retired/);
  await assert.rejects(readFile(marker));

  // An IPC test wrapper emits Node's signal event, exercising graceful cleanup on
  // Windows as well (child.kill('SIGTERM') forcibly terminates there).
  const wrapper = join(directory, "signal-wrapper.mjs");
  await writeFile(wrapper, `process.on("message",()=>process.emit("SIGTERM"));await import(${JSON.stringify(pathToFileURL(cli).href)});`);
  for (const entry of [wrapper, pguide]) {
    const child = spawn(process.execPath, [entry, ...(entry === pguide ? ["task-engine"] : []),
      "--no-global-config", "--cwd", cwd, "--config", "server.yaml"], {
      cwd: directory, env, windowsHide: true,
      stdio: entry === wrapper ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    });
    let text = ""; let stderr = "";
    child.stderr!.on("data", (chunk) => { stderr += chunk; });
    const exited = new Promise<number | null>((done) => child.on("close", done));
    try {
      const ready = await new Promise<{ url: string; pid: number }>((done, reject) => {
        const timer = setTimeout(() => reject(new Error(`Readiness timeout: ${stderr}`)), 20_000);
        child.on("error", reject);
        child.on("exit", () => { clearTimeout(timer); reject(new Error(`Early exit: ${stderr}`)); });
        child.stdout!.on("data", (chunk) => {
          text += chunk;
          for (const line of text.split("\n")) {
            try {
              const value = JSON.parse(line);
              if (value.event === "ready") { clearTimeout(timer); done(value); }
            } catch {}
          }
        });
      });
      assert.equal((await fetch(`${ready.url}/tasks`)).status, 200);
      assert.ok(await readFile(join(cwd, "owned.sqlite")));
      if (entry === wrapper) {
        child.send("stop");
        // IPC belongs to this test, not to the production command.
        child.disconnect();
        assert.equal(await exited, 0);
        assert.match(text, /"event":"closed"/);
      } else {
        // Terminate only the child PID reported by this invocation, not other services.
        process.kill(ready.pid, "SIGTERM");
        await exited;
      }
      await assert.rejects(fetch(`${ready.url}/tasks`));
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
  }
});
