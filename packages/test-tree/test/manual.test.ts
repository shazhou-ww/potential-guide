import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as pause } from "node:timers/promises";

const cli = resolve("test", "check-host", "manual.ts");
function command(...args: string[]) {
  const result = spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(result.status, 0, `${args[0]}: ${result.stdout}${result.stderr}`);
  return result.stdout.trim();
}
test("documented manual commands prepare, serve, inspect, cancel, release, fail, recover and clean real resources", async () => {
  for (const branch of ["cancel", "fault"]) {
    const directory = command("prepare");
    const server = spawn(process.execPath, ["--import", "tsx", cli, "serve", directory], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const exited = once(server, "exit");
    let output = "";
    server.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    server.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    try {
      const deadline = Date.now() + 10_000;
      while (!output.includes("Ready:")) {
        assert.equal(server.exitCode, null, output);
        assert.ok(Date.now() < deadline, output);
        await pause(20);
      }
      command("inspect", directory, "idle");
      if (branch === "cancel") {
        command("run", directory);
        command("inspect", directory, "running");
        command("cancel", directory);
        command("inspect", directory, "cancelling");
        command("release", directory);
        command("inspect", directory, "cancelled");
        command("finish", directory);
      } else {
        command("fault", directory);
        command("inspect", directory, "faulted");
        command("recover", directory);
        command("inspect", directory, "recovered");
      }
    } finally {
      server.stdin.end("stop\n");
      const deadline = setTimeout(() => {
        server.kill();
      }, 15_000);
      try {
        const [code] = await exited;
        assert.equal(code, 0, output);
        assert.match(output, /Owned Host and workers stopped/);
      } finally {
        clearTimeout(deadline);
      }
      command("clean", directory);
    }
  }
});
