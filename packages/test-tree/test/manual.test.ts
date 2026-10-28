import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  CheckClient,
  type HostAddress,
  HostError,
  processAlive,
  terminal,
} from "@potential-guide/checker-host";
import { type Instructions, loadTree, paths } from "../src/model.js";

const root = resolve("..", "..");
const loaded = await loadTree(resolve("test", "check-host", "host.states.yaml"));
type Platform = "posix" | "powershell";
function content(value: Instructions, platform: Platform): string {
  assert.notEqual(typeof value, "string", "Every operation must separate both platforms");
  return (value as Exclude<Instructions, string>)[platform];
}
function commands(value: Instructions, platform: Platform): string {
  const language = platform === "posix" ? "bash" : "powershell";
  return [
    ...content(value, platform).matchAll(
      new RegExp(`^\`\`\`${language}\\n([\\s\\S]*?)^\`\`\``, "gm"),
    ),
  ]
    .map((match) => match[1])
    .join("\n");
}
const all = new Map(paths(loaded.tree).flatMap((p) => p.states.map((s) => [s.id, s] as const)));
function state(id: string) {
  const value = all.get(id);
  assert.ok(value);
  return value;
}
function observation(id: string) {
  const check = state(id).checks[0];
  assert.ok(check);
  return check.doc;
}
test("isolated preparation uses explained native steps without JavaScript or line-count compression", async () => {
  for (const platform of ["posix", "powershell"] as const) {
    const code = commands(state("isolated").before, platform);
    assert.ok(
      !/\bnode\b|--input-type|await |import\(|host\.mjs|exports\.execute|writeFile|WriteAllText|<<|@'|CheckKernel|connectHost|serve\(/.test(
        code,
      ),
    );
    const instructions = content(state("isolated").before, platform);
    for (const step of ["1.", "2.", "3.", "4.", "预期"])
      assert.ok(instructions.includes(step), `${platform}: missing purpose/result for ${step}`);
    assert.ok(
      [
        ...instructions.matchAll(
          new RegExp(`^\`\`\`${platform === "posix" ? "bash" : "powershell"}\\n`, "gm"),
        ),
      ].length >= 4,
      `${platform}: keep operations in separate readable blocks`,
    );
    if (platform === "posix") assert.match(code, /mktemp -d/);
    else {
      assert.match(code, /New-Item/);
      assert.match(code, /icacls/);
      assert.ok(code.indexOf("icacls") < code.indexOf("Copy-Item"));
      assert.match(code, /icacls "\$case"\s*\n/);
    }
    assert.match(code, /packages\/check-host\/examples\/cancellable/);
    const startup = commands(state("ready").before, platform);
    assert.match(startup, /connectHost\(process\.argv\[2\]\)/);
    assert.match(startup, /closePrivateFileBackend/);
    assert.match(startup, /host\.json/);
    assert.ok(!/CheckKernel|serve\(|connection\.json/.test(startup));
    assert.ok(!/const a=|try\{await|finally\{await/.test(startup));
  }
  const sample = await readFile(
    resolve(root, "packages/check-host/examples/cancellable/worker.cjs"),
    "utf8",
  );
  assert.ok(!/node:test|test-tree|CheckClient|connectHost|process\.argv/.test(sample));
  assert.match(sample, /exports.execute/);
});
test("human platform instructions use native HTTP and the original discovery daemon", () => {
  assert.equal(all.size, 7);
  for (const s of all.values()) {
    for (const value of [s.before, s.after, ...s.checks.map((c) => c.doc)]) {
      for (const platform of ["posix", "powershell"] as const) {
        const code = commands(value, platform);
        assert.ok(
          !/manual\.ts|host\.binding|test-tree|tsx|CheckClient|\.editor|node -i/.test(code),
        );
        if (s.id !== "isolated" && s.id !== "ready")
          assert.ok(!/```js|await |api\./.test(content(value, platform)));
      }
    }
  }
  assert.match(content(state("isolated").before, "posix"), /jq >=1.6/);
  assert.match(content(state("ready").after, "powershell"), /强制/);
  assert.match(content(state("ready").after, "powershell"), /不能证明.*优雅/);
});

const platform: Platform = process.platform === "win32" ? "powershell" : "posix";
const executable = platform === "powershell" ? "powershell.exe" : "/bin/bash";
const prerequisites =
  platform === "posix"
    ? spawnSync("/bin/bash", ["-c", "command -v curl && command -v jq"], { encoding: "utf8" })
    : spawnSync(executable, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
        encoding: "utf8",
      });
test("short documented commands exercise and stop the actual isolated discovery daemon", {
  skip:
    prerequisites.status === 0
      ? false
      : `Native ${platform} prerequisites unavailable: ${prerequisites.stderr || prerequisites.error?.message}`,
}, async () => {
  const scripts = resolve(root, ".cache", "platform-manual-tests", randomUUID());
  await mkdir(scripts, { recursive: true });
  let counter = 0;
  const execute = async (code: string) => {
    const file = join(scripts, `${counter++}.${platform === "powershell" ? "ps1" : "sh"}`);
    await writeFile(file, code);
    const result = spawnSync(
      executable,
      platform === "powershell" ? ["-NoLogo", "-NoProfile", "-File", file] : [file],
      { cwd: root, encoding: "utf8", timeout: 40_000 },
    );
    assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const setCase = (directory: string) =>
    platform === "powershell"
      ? `$ErrorActionPreference='Stop'; $case='${directory.replaceAll("'", "''")}'`
      : `set -e; set -o pipefail; umask 077; case_dir='${directory.replaceAll("'", "'\\''")}'`;
  const poll = (id: string, expected: string) =>
    platform === "powershell"
      ? `for($n=0; ;$n++){ $s=Invoke-RestMethod "$endpoint/checks/${id}" -Headers $headers; if($s.state -eq '${expected}' ${expected === "Running" ? "-and $s.progress" : ""}){break};if($n -gt 100){throw 'Observation deadline'};Start-Sleep -Milliseconds 10 }`
      : `for n in $(seq 1 100); do s=$(curl -fsS --header "@$auth_file" "$endpoint/checks/${id}"); if printf '%s' "$s" | jq -e '.state == "${expected}" ${expected === "Running" ? "and .progress != null" : ""}' >/dev/null; then break; fi; [ "$n" -lt 100 ] || exit 1; sleep 0.01; done`;
  try {
    for (const branch of ["cancel", "fault"]) {
      const prepared = await execute(commands(state("isolated").before, platform));
      const directory = prepared.match(/^CASE_DIRECTORY=(.+)\r?$/m)?.[1]?.trim();
      assert.ok(directory, prepared);
      assert.equal(
        await readFile(join(directory, "artifact", "worker.cjs"), "utf8"),
        await readFile(
          resolve(root, "packages/check-host/examples/cancellable/worker.cjs"),
          "utf8",
        ),
      );
      const errors: unknown[] = [];
      try {
        const lines = [
          setCase(directory),
          commands(state("ready").before, platform),
          commands(observation("ready"), platform),
        ];
        const route =
          branch === "cancel"
            ? [
                ["running", "held", "Running"],
                ["cancelling", "held", "Cancelling"],
                ["cancelled", "held", "Cancelled"],
              ]
            : [
                ["faulted", "fault", "Failed"],
                ["recovered", "recovery", "Completed"],
              ];
        for (const [id, checkId, expected] of route) {
          assert.ok(id && checkId && expected);
          lines.push(commands(state(id).before, platform), poll(checkId, expected));
          if (id === "cancelling")
            lines.push(
              platform === "powershell"
                ? `for($n=0;!(Test-Path (Join-Path $case 'controls/cleaning'));$n++){if($n -gt 100){throw 'No cleaning'};Start-Sleep -Milliseconds 10}`
                : `for n in $(seq 1 100); do [ ! -f "$case_dir/controls/cleaning" ] || break; [ "$n" -lt 100 ] || exit 1; sleep 0.01; done`,
            );
          lines.push(commands(observation(id), platform));
        }
        if (branch === "cancel") lines.push(commands(state("running").after, platform));
        lines.push(
          platform === "powershell"
            ? `${
                branch === "fault"
                  ? `if($remainingFault.state -ne 'Failed' -or $remainingFault.error -cne 'Error: manual injected failure'){throw 'History changed'}
            if(($originalFault|ConvertTo-Json -Compress) -cne ($remainingFault|ConvertTo-Json -Compress)){throw 'History changed'}
            $recovery=Invoke-RestMethod "$endpoint/checks/recovery" -Headers $headers
            if($recovery.state -ne 'Completed' -or $recovery.result.calls -ne 2){throw 'Recovery mismatch'}`
                  : `if(!(Test-Path (Join-Path $case 'controls/cleaned'))){throw 'Missing cleanup'}`
              }
            Write-Output 'NATIVE_FLOW_OK'`
            : `${
                branch === "fault"
                  ? `jq -e '.state == "Failed" and .error == "Error: manual injected failure"' "$case_dir/fault-after.json" >/dev/null
               curl -fsS --header "@$auth_file" "$endpoint/checks/recovery" | jq -e '.state == "Completed" and .result.calls == 2' >/dev/null`
                  : `curl -fsS --header "@$auth_file" "$endpoint/checks/held" | jq -e '.state == "Cancelled"' >/dev/null
               test -f "$case_dir/controls/cleaned"`
              }
             printf 'NATIVE_FLOW_OK\\n'`,
        );
        lines.push(
          commands(state("ready").after, platform),
          commands(state("isolated").after, platform),
        );
        assert.match(await execute(lines.join("\n")), /NATIVE_FLOW_OK/);
        await assert.rejects(readFile(join(directory, "host", "host.json")), /ENOENT/);
      } catch (error) {
        errors.push(error);
      }
      try {
        // If a regression interrupts the native flow, release only this scene's resources.
        const descriptor = await readFile(join(directory, "host", "host.json"), "utf8").catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          },
        );
        if (descriptor) {
          const address = JSON.parse(descriptor) as HostAddress;
          if (processAlive(address.pid)) {
            await writeFile(join(directory, "controls", "release"), "released");
            const client = new CheckClient(address);
            for (const id of ["held", "fault", "recovery"]) {
              try {
                if (!terminal(await client.sample(id))) await client.cancel(id);
                await client.wait(id, AbortSignal.timeout(10_000));
              } catch (error) {
                if (!(error instanceof HostError && error.status === 404)) throw error;
              }
            }
            const context =
              platform === "powershell"
                ? `$hostDirectory=Join-Path $case 'host';$address=Get-Content (Join-Path $hostDirectory 'host.json') -Raw|ConvertFrom-Json;$endpoint=$address.endpoint;$ownedPid=[int]$address.pid;$headers=@{Authorization='Bearer '+$address.token}`
                : `host_directory="$case_dir/host";endpoint=$(jq -er '.endpoint' "$host_directory/host.json");owned_pid=$(jq -er '.pid' "$host_directory/host.json");auth_file="$case_dir/auth-header";jq -er '"Authorization: Bearer " + .token' "$host_directory/host.json" > "$auth_file"`;
            await execute(
              [
                setCase(directory),
                context,
                commands(state("ready").after, platform),
                commands(state("isolated").after, platform),
              ].join("\n"),
            );
          }
        }
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, "Native manual execution/cleanup failed");
    }
  } finally {
    await rm(scripts, { recursive: true, force: true });
  }
});
