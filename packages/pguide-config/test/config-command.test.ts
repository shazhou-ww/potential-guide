import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("config path is available without creating configuration", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pguide-config-command-"));
  try {
    const script = resolve(import.meta.dirname, "..", "dist", "bin.js");
    const result = await new Promise<{ code: number; stdout: string }>((resolveRun, reject) => {
      const child = spawn(process.execPath, [script, "path", "--cwd", cwd, "--format", "json"]);
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });

      function run(
        script: string,
        args: string[],
        env: NodeJS.ProcessEnv,
      ): Promise<{ code: number; stdout: string }> {
        return new Promise((resolveRun, reject) => {
          const child = spawn(process.execPath, [script, ...args], { env });
          let stdout = "";
          child.stdout.setEncoding("utf8");
          child.stdout.on("data", (chunk) => {
            stdout += chunk;
          });
          child.on("error", reject);
          child.on("close", (code) => resolveRun({ code: code ?? 70, stdout }));
        });
      }

      test("config edit validates a temporary copy before atomically replacing the target", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "pguide-config-edit-"));
        try {
          const script = resolve(import.meta.dirname, "..", "dist", "bin.js");
          const target = join(cwd, ".pguide", "config.yaml");
          const editor = join(cwd, "editor.mjs");
          await writeFile(
            editor,
            `import{writeFile}from"node:fs/promises";await writeFile(process.argv.at(-1),process.env.EDIT_CONTENT);`,
          );
          const visual = `"${process.execPath}" "${editor}"`;
          const first = await run(script, ["edit", "--cwd", cwd], {
            ...process.env,
            VISUAL: visual,
            EDIT_CONTENT: "schemaVersion: 1\nretentionDays: 7\n",
          });

          test("show-agent rejects secret-bearing transport arguments without echoing them", async () => {
            const cwd = await mkdtemp(join(tmpdir(), "pguide-config-secret-"));
            try {
              const script = resolve(import.meta.dirname, "..", "dist", "bin.js");
              const config = join(cwd, "config.yaml");
              await writeFile(
                config,
                'schemaVersion: 1\nagents:\n  fixture:\n    connection: {type: acp, protocolVersion: "1"}\n    transport: {type: stdio, command: fixture, args: ["--token=do-not-print"]}\n',
              );
              const result = await run(
                script,
                ["show-agent", "fixture", "--config", config, "--format", "json"],
                process.env,
              );
              assert.equal(result.code, 2);
              assert.doesNotMatch(result.stdout, /do-not-print/);
            } finally {
              await rm(cwd, { recursive: true, force: true });
            }
          });
          assert.equal(first.code, 0, first.stdout);
          assert.match(await readFile(target, "utf8"), /retentionDays: 7/);

          const invalid = await run(script, ["edit", "--cwd", cwd], {
            ...process.env,
            VISUAL: visual,
            EDIT_CONTENT: "schemaVersion: 2\n",
          });
          assert.equal(invalid.code, 2, invalid.stdout);
          assert.match(await readFile(target, "utf8"), /retentionDays: 7/);
          assert.deepEqual((await readdir(join(cwd, ".pguide"))).sort(), ["config.yaml"]);
        } finally {
          await rm(cwd, { recursive: true, force: true });
        }
      });
      child.on("error", reject);
      child.on("close", (code) => resolveRun({ code: code ?? 70, stdout }));
    });
    assert.equal(result.code, 0);
    assert.ok(JSON.parse(result.stdout).paths.user);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
