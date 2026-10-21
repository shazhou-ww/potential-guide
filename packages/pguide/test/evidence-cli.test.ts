import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { bin, fixture, run } from "./fixtures.js";

test("probe and scaffold preserve stdout/export while retaining default, configured and overridden evidence", async () => {
  const f = await fixture();
  try {
    await f.commit();
    const state = join(f.directory, "state");
    const configured = join(f.directory, "configured");
    const overridden = join(f.directory, "override");
    const config = join(f.directory, "config.json");
    const exportPath = join(f.directory, "legacy.json");
    const base = { schemaVersion: 2, stateDirectory: state };
    const args = [
      "--pilot",
      f.manifest,
      "--subject-file",
      f.subject,
      "--fixture-config",
      config,
      "--format",
      "json",
    ];
    await writeFile(config, JSON.stringify(base));
    const first = await run(bin("probe"), [...args, "--report", exportPath]);
    assert.equal(first.code, 0, first.stdout + first.stderr);
    assert.deepEqual(JSON.parse(await readFile(exportPath, "utf8")), JSON.parse(first.stdout));
    const defaultReports = join(state, "reports");
    const [runId] = await readdir(defaultReports);
    assert.ok(runId);
    const directory = join(defaultReports, runId);
    const entries = (await readFile(join(directory, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const start = entries.find((entry) => entry.event === "check.started");
    assert.ok(start);
    assert.equal(start.data.identity.checkId, "ready");
    const business = await readFile(join(directory, start.data.directory, "events.jsonl"), "utf8");
    assert.match(business, /assertion.passed/);
    assert.equal(entries.at(-1).event, "run.finished");
    assert.deepEqual(
      entries.find((entry) => entry.event === "probe.observation").data,
      JSON.parse(first.stdout),
    );
    await writeFile(config, JSON.stringify({ ...base, reports: { directory: configured } }));
    for (const extra of [[], ["--report-dir", overridden]]) {
      const result = await run(bin("probe"), [...args, ...extra]);
      assert.equal(result.code, 0, result.stdout + result.stderr);
    }
    assert.equal((await readdir(configured)).length, 1);
    assert.equal((await readdir(overridden)).length, 1);
    const disabled = join(f.directory, "disabled");
    for (const extra of [["--no-reports"], []]) {
      if (extra.length === 0)
        await writeFile(config, JSON.stringify({ ...base, reports: { enabled: false } }));
      const result = await run(bin("probe"), [...args, "--report-dir", disabled, ...extra]);
      assert.equal(result.code, 0, result.stdout + result.stderr);
    }
    await assert.rejects(readdir(disabled), { code: "ENOENT" });
    await mkdir(join(f.directory, "bad-parent"));
    const blocked = join(f.directory, "bad-parent", "file");
    await writeFile(blocked, "");
    await writeFile(config, JSON.stringify(base));
    const failed = await run(bin("probe"), [...args, "--report-dir", blocked]);
    assert.notEqual(failed.code, 0);
    assert.match(failed.stdout + failed.stderr, /ENOTDIR|EEXIST/);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
