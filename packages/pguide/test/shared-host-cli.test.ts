import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { CheckClient } from "../../check-host/dist/index.js";
import { bin, fixture, root, run, scratch } from "./fixtures.js";

async function stopOwnedHost(pid: number) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  const end = Date.now() + 5000;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    assert.ok(Date.now() < end, `Owned Host PID ${pid} did not stop.`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

test("two real CLI processes race discovery once, share a Host and reuse its workers", async () => {
  const f = await fixture();
  const directory = await mkdtemp(join(scratch, "shared-cli-host-"));
  const journal = join(directory, "spawned-hosts.jsonl");
  const preload = join(directory, "track-host.mjs");
  const main = join(root, "packages", "check-host", "dist", "main.js");
  const owned = new Set<number>();
  try {
    await writeFile(
      preload,
      `
import cp from "node:child_process";
import {appendFileSync} from "node:fs";
import {syncBuiltinESMExports} from "node:module";
const spawn=cp.spawn;
cp.spawn=function(command,args,options){
  const child=spawn(command,args,options);
  if(command===process.execPath && args[0]===${JSON.stringify(main)} && args[1]===${JSON.stringify(directory)})
    child.once("spawn",()=>appendFileSync(${JSON.stringify(journal)},JSON.stringify({pid:child.pid})+"\\n"));
  return child;
};
syncBuiltinESMExports();
`,
    );
    await writeFile(
      join(f.repository, "objective", "checks", "ready", "worker.cjs"),
      `const {threadId}=require("node:worker_threads");let calls=0;
exports.execute=async()=>({status:200,message:"",payload:{ok:false,problems:[{kind:"internal",id:"not-ready",parameters:{pid:process.pid,threadId,calls:++calls}}]}});`,
    );
    const revision = await f.commit();
    const config = join(f.directory, ".pguide");
    await mkdir(config);
    await writeFile(
      join(config, "config.jsonc"),
      JSON.stringify({ "pilot.reportsEnabled": false }),
    );
    const env = {
      ...process.env,
      PGUIDE_CHECK_HOST_DIRECTORY: directory,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
    };
    const invoke = async () => {
      const response = await run(
        bin("probe"),
        [
          "--pilot",
          f.uri,
          "--revision",
          revision,
          "--subject-file",
          f.subject,
          "--cwd",
          f.directory,
          "--format",
          "json",
        ],
        env,
      );
      assert.equal(response.code, 0, response.stdout + response.stderr);
      const envelope = JSON.parse(response.stdout);
      assert.ok(envelope.payload, response.stdout);
      return envelope.payload.problems[0].parameters as {
        pid: number;
        threadId: number;
        calls: number;
      };
    };
    const starts = await Promise.allSettled([invoke(), invoke()]);
    const initial = starts.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    const descriptor = JSON.parse(await readFile(join(directory, "host.json"), "utf8"));
    const launched = (await readFile(journal, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { pid: number });
    for (const { pid } of launched) owned.add(pid);
    assert.equal(launched.length, 1);
    assert.equal(descriptor.pid, launched[0]?.pid);
    const client = new CheckClient(descriptor);
    const ready = await fetch(`${descriptor.endpoint}/checks`, {
      headers: { authorization: `Bearer ${descriptor.token}` },
      signal: AbortSignal.timeout(1000),
    });
    assert.equal(ready.status, 200);
    await ready.body?.cancel();
    for (const result of initial) assert.equal(result.pid, descriptor.pid);
    const later = await invoke();
    assert.equal(later.pid, descriptor.pid);
    assert.ok(later.calls >= 2, "A subsequent CLI must reuse an initialized worker.");
    assert.deepEqual(
      await (
        await fetch(`${client.address.endpoint}/checks`, {
          headers: { authorization: `Bearer ${client.address.token}` },
        })
      ).json(),
      [],
    );
  } finally {
    const journalText = await readFile(journal, "utf8").catch(() => "");
    for (const line of journalText.trim().split("\n").filter(Boolean)) {
      const { pid } = JSON.parse(line) as { pid: number };
      assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid);
      owned.add(pid);
    }
    for (const pid of owned) await stopOwnedHost(pid);
    await rm(directory, { recursive: true, force: true });
    await rm(f.directory, { recursive: true, force: true });
  }
});
