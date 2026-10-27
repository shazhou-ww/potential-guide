import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { type Instructions, loadTree, paths } from "../src/model.js";

const root = resolve("..", "..");
const loaded = await loadTree(resolve("test", "check-host", "host.states.yaml"));
type Platform = "posix" | "powershell";
function content(value: Instructions, platform: Platform): string {
  assert.notEqual(typeof value, "string", "Every Host operation must separate both platforms");
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
test("human platform instructions use native HTTP and explicit SDK bootstrap, not test wrappers", () => {
  assert.equal(all.size, 7);
  for (const s of all.values()) {
    for (const value of [s.before, s.after, ...s.checks.map((c) => c.doc)]) {
      for (const platform of ["posix", "powershell"] as const) {
        const code = commands(value, platform);
        assert.ok(
          !/manual\.ts|host\.binding|test-tree|tsx|CheckClient|\.editor|node -i/.test(code),
        );
        if (s.id !== "isolated" && s.id !== "ready") {
          assert.ok(!/```js|await |api\./.test(content(value, platform)));
        }
      }
    }
  }
  assert.match(content(state("isolated").before, "posix"), /jq >=1.6/);
  assert.match(content(state("isolated").before, "posix"), /Bash 3.2/);
  assert.match(content(state("ready").before, "powershell"), /Read-Host/);
});

const platform: Platform = process.platform === "win32" ? "powershell" : "posix";
const executable = platform === "powershell" ? "powershell.exe" : "/bin/bash";
const prerequisites =
  platform === "posix"
    ? spawnSync("/bin/bash", ["-c", "command -v curl && command -v jq"], { encoding: "utf8" })
    : spawnSync(executable, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
        encoding: "utf8",
      });
test("documented native platform commands reproduce cancellation and failure/recovery", {
  skip:
    prerequisites.status === 0
      ? false
      : `Native ${platform} prerequisites unavailable: ${prerequisites.stderr || prerequisites.error?.message}`,
}, async () => {
  const scripts = resolve(root, ".cache", "platform-manual-tests", randomUUID());
  await mkdir(scripts, { recursive: true });
  let counter = 0;
  const execute = async (code: string, input = "") => {
    const file = join(scripts, `${counter++}.${platform === "powershell" ? "ps1" : "sh"}`);
    await writeFile(file, code);
    const args = platform === "powershell" ? ["-NoLogo", "-NoProfile", "-File", file] : [file];
    const result = spawnSync(executable, args, {
      cwd: root,
      input,
      encoding: "utf8",
      timeout: 40_000,
    });
    assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const poll = (id: string, expected: string) =>
    platform === "powershell"
      ? `for ($attempt=0; ; $attempt++) {
        $snapshot=Invoke-RestMethod -Uri "$endpoint/checks/${id}" -Headers $headers
        if ($snapshot.state -eq '${expected}' ${expected === "Running" ? "-and $snapshot.progress" : ""}) { break }
        if ($attempt -gt 300) { throw 'Expected ${id}/${expected}' }
        Start-Sleep -Milliseconds 20
      }`
      : `for attempt in $(seq 1 300); do
        snapshot=$(curl -fsS --header "@$auth_file" "$endpoint/checks/${id}")
        if printf '%s' "$snapshot" | jq -e '.state == "${expected}" ${expected === "Running" ? "and .progress != null" : ""}' >/dev/null; then break; fi
        [ "$attempt" -lt 300 ] || exit 1
        sleep 0.02
      done`;
  try {
    for (const branch of ["cancel", "fault"]) {
      const prepared = await execute(commands(state("isolated").before, platform));
      const directory = prepared.match(/^CASE_DIRECTORY=(.+)\r?$/m)?.[1]?.trim();
      assert.ok(directory, prepared);
      const server = spawn(process.execPath, [join(directory, "host.mjs"), directory], {
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
        const end = Date.now() + 15_000;
        while (!output.includes("Ready")) {
          assert.equal(server.exitCode, null, output);
          assert.ok(Date.now() < end, output);
          await pause(20);
        }
        const ids =
          branch === "cancel" ? ["running", "cancelling", "cancelled"] : ["faulted", "recovered"];
        const lines = [
          commands(state("ready").before, platform),
          commands(observation("ready"), platform),
        ];
        for (const id of ids) {
          lines.push(commands(state(id).before, platform));
          lines.push(
            poll(
              id === "faulted" ? "fault" : id === "recovered" ? "recovery" : "held",
              id === "running"
                ? "Running"
                : id === "cancelling"
                  ? "Cancelling"
                  : id === "cancelled"
                    ? "Cancelled"
                    : id === "faulted"
                      ? "Failed"
                      : "Completed",
            ),
          );
          if (id === "cancelling")
            lines.push(
              platform === "powershell"
                ? `for ($n=0; !(Test-Path -LiteralPath (Join-Path $case 'controls/cleaning')); $n++) { if($n -gt 300){throw 'Missing cleaning'}; Start-Sleep -Milliseconds 20 }`
                : `while [ ! -f "$case_dir/controls/cleaning" ]; do sleep 0.02; done`,
            );
          lines.push(commands(observation(id), platform));
        }
        if (branch === "cancel") lines.push(commands(state("running").after, platform));
        const final = branch === "cancel" ? "held" : "recovery";
        const expected = branch === "cancel" ? "Cancelled" : "Completed";
        lines.push(
          platform === "powershell"
            ? `$final=Invoke-RestMethod -Uri "$endpoint/checks/${final}" -Headers $headers
             if($final.state -ne '${expected}') { throw 'Wrong terminal state' }
             $active=Invoke-RestMethod -Uri "$endpoint/checks" -Headers $headers
             if($active.Count -ne 0) { throw 'Not idle' }
             ${
               branch === "fault"
                 ? `if($final.result.calls -ne 2 -or $remainingFault.state -ne 'Failed' -or $remainingFault.error -cne 'Error: manual injected failure') {throw 'Recovery mismatch'}
             if(($originalFault|ConvertTo-Json -Compress) -cne ($remainingFault|ConvertTo-Json -Compress)){throw 'History changed'}`
                 : `if(!(Test-Path -LiteralPath (Join-Path $case 'controls/cleaned'))){throw 'Missing cleaned'}`
             }
             Write-Output 'NATIVE_FLOW_OK'`
            : `curl -fsS --header "@$auth_file" "$endpoint/checks/${final}" | jq -e '.state == "${expected}"' >/dev/null
             curl -fsS --header "@$auth_file" "$endpoint/checks" | jq -e 'length == 0' >/dev/null
             ${branch === "fault" ? `jq -e '.state == "Failed" and .error == "Error: manual injected failure"' "$case_dir/fault-after.json" >/dev/null` : `test -f "$case_dir/controls/cleaned"`}
             printf 'NATIVE_FLOW_OK\\n'`,
        );
        assert.match(await execute(lines.join("\n"), `${directory}\n`), /NATIVE_FLOW_OK/);
      } finally {
        await writeFile(join(directory, "controls", "release"), "released");
        server.stdin.end("stop\n");
        const deadline = setTimeout(() => server.kill(), 15_000);
        try {
          const [code] = await exited;
          assert.equal(code, 0, output);
          assert.match(output, /Host and workers stopped/);
        } finally {
          clearTimeout(deadline);
        }
        await execute(
          [
            commands(state("ready").before, platform),
            commands(state("ready").after, platform),
            commands(state("isolated").after, platform),
          ].join("\n"),
          `${directory}\n`,
        );
        await assert.rejects(readFile(join(directory, "connection.json")), /ENOENT/);
      }
    }
  } finally {
    await rm(scripts, { recursive: true, force: true });
  }
});
