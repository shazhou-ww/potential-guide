import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { loadTree, paths } from "../src/model.js";

const root = resolve("..", "..");
const loaded = await loadTree(resolve("test", "check-host", "host.states.yaml"));
const prose = paths(loaded.tree).flatMap((path) => [
  ...path.states.flatMap((state) => [state.before, state.after]),
  path.check.doc,
]);
const documented = new Set(
  prose.flatMap((text) => text.split("\n").filter((line) => line.startsWith("pnpm --filter "))),
);
function argumentsFor(...args: string[]): string[] {
  const pnpm = process.env.npm_execpath;
  assert.ok(pnpm, "Run this test through pnpm test so the documented pnpm entry is available");
  const template = args.map((arg, index) => (index === 1 ? '"SCENARIO_DIRECTORY"' : arg)).join(" ");
  assert.ok(
    documented.has(
      `pnpm --filter @potential-guide/test-tree exec tsx test/check-host/manual.ts ${template}`,
    ),
    `Missing manual command: ${template}`,
  );
  return [
    pnpm,
    "--filter",
    "@potential-guide/test-tree",
    "exec",
    "tsx",
    "test/check-host/manual.ts",
    ...args,
  ];
}
function command(...args: string[]) {
  const result = spawnSync(process.execPath, argumentsFor(...args), {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(result.status, 0, `${args[0]}: ${result.stdout}${result.stderr}`);
  return result.stdout.trim();
}
test("manual command blocks are shell-neutral and use one explicit scenario placeholder", () => {
  assert.equal(documented.size, 15);
  for (const text of prose) {
    assert.ok(!text.includes("```powershell"));
    assert.ok(!text.includes("$case"));
    assert.ok(!text.includes("PowerShell A"));
    assert.ok(!text.includes("\\"));
  }
  for (const line of documented) {
    assert.ok(!/[|&;$`\\]/.test(line), line);
    if (!line.endsWith(" prepare")) assert.ok(line.includes('"SCENARIO_DIRECTORY"'), line);
  }
  assert.ok(loaded.tree.state.before.includes("手动替换"));
});

test("documented manual commands prepare, serve, inspect, cancel, release, fail, recover and clean real resources", async () => {
  for (const branch of ["cancel", "fault"]) {
    const directory = command("prepare");
    const server = spawn(process.execPath, argumentsFor("serve", directory), {
      cwd: root,
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
