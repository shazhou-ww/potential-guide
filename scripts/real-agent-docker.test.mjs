import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { runBaseline, verifyMarker } from "./self-check-docker/real-agent.mjs";

function fixture(mode) {
  const observed = { prompts: 0, stops: 0 };
  class Client {
    updates = [];
    constructor(profile, _onUpdate, options) {
      observed.profile = profile;
      this.options = options;
    }
    async initialize() {
      if (mode === "authentication")
        throw new Error("authentication required; SECRET-AUTHENTICATION-DATA");
    }
    async request() {
      return {
        sessionId: "fixture",
        models: {
          currentModelId: mode === "model-mismatch" ? "other-model" : "fixture-model",
          availableModels: [{ modelId: "fixture-model" }],
        },
      };
    }
    async prompt(_sessionId, prompt) {
      observed.prompts += 1;
      if (mode === "timeout")
        return new Promise((_resolve, reject) => {
          this.reject = reject;
        });
      const expected = JSON.parse(prompt.split("exactly ")[1].split(", without")[0]);
      const pattern = observed.profile.transport.args.find((arg) => arg.startsWith("write("));
      const marker = pattern.slice("write(".length, -1);
      if (mode !== "summary-only") await writeFile(marker, mode === "wrong" ? "wrong" : expected);
      if (mode === "denied") await this.options.permissionHandler();
      return {
        status: mode === "incomplete" ? "blocked" : "completed",
        summary: "SECRET-MODEL-TEXT",
      };
    }
    async stop() {
      observed.stops += 1;
      this.reject?.(new Error("Cancelled fixture."));
      if (mode === "cleanup-failed") throw new Error("SECRET-CLEANUP-DATA");
    }
    async cancelAndStop() {
      await this.stop();
    }
  }
  return { Client, observed };
}

test("real Agent baseline requires one completed repair and exact independent recheck", async () => {
  const root = await mkdtemp(join(tmpdir(), "pguide-real-baseline-"));
  try {
    const { Client, observed } = fixture("fix");
    const report = await runBaseline(
      { model: "fixture-model", runsDirectory: root, timeoutMs: 1000 },
      Client,
    );
    assert.equal(report.status, "ready");
    assert.equal(report.markerVerified, true);
    assert.match(report.markerSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.promptCount, 1);
    assert.equal(observed.prompts, 1);
    assert.equal(observed.stops, 1);
    assert.equal(report.taskCleaned, true);
    assert.deepEqual(await readdir(report.run), ["baseline.json"]);
    const args = observed.profile.transport.args;
    assert.ok(args.includes("--disallow-temp-dir"));
    assert.ok(args.includes("--no-auto-update"));
    assert.equal(args.includes("--allow-all"), false);
    assert.deepEqual(observed.profile.transport.env, ["HOME"]);
    const pattern = args.find((arg) => arg.startsWith("write("));
    assert.equal(isAbsolute(pattern.slice("write(".length, -1)), true);
    assert.doesNotMatch(await readFile(join(report.run, "baseline.json"), "utf8"), /SECRET-/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readiness and advertised model lists never count as real Agent readiness", async () => {
  const root = await mkdtemp(join(tmpdir(), "pguide-real-discovery-"));
  try {
    const { Client, observed } = fixture("fix");
    const report = await runBaseline({ mode: "discover", runsDirectory: root }, Client);
    assert.equal(report.status, "discovered");
    assert.equal(report.markerVerified, false);
    assert.equal(observed.prompts, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("baseline rejects auth, unknown models, fake repairs, denial, timeout and cleanup failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "pguide-real-failures-"));
  try {
    for (const [mode, reason, prompts] of [
      ["authentication", "authentication-required", 0],
      ["model-mismatch", "model-mismatch", 0],
      ["unknown-model", "model-not-advertised", 0],
      ["wrong", "marker-mismatch", 1],
      ["summary-only", "marker-mismatch", 1],
      ["denied", "permission-denied", 1],
      ["incomplete", "incomplete-turn", 1],
      ["timeout", "deadline", 1],
      ["cleanup-failed", "agent-cleanup-failed", 1],
    ]) {
      const { Client, observed } = fixture(mode);
      const report = await runBaseline(
        {
          model: mode === "unknown-model" ? "unknown-model" : "fixture-model",
          runsDirectory: root,
          timeoutMs: 100,
        },
        Client,
      );
      assert.equal(report.status, "failed", mode);
      assert.equal(report.reason, reason, mode);
      assert.equal(observed.prompts, prompts, mode);
      assert.equal(observed.stops, 1, mode);
      assert.equal(report.taskCleaned, true, mode);
      assert.doesNotMatch(JSON.stringify(report), /SECRET-/);
    }
    await assert.rejects(runBaseline({ model: "fixture-model", timeoutMs: 120001 }), /Invalid/);
    await assert.rejects(runBaseline({ model: "fixture-model", timeoutMs: Number.NaN }), /Invalid/);
    await assert.rejects(runBaseline({}), /Invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("marker verification rejects same-content links and wrong content", async () => {
  const root = await mkdtemp(join(tmpdir(), "pguide-real-marker-"));
  try {
    await mkdir(join(root, "task"));
    const marker = join(root, "task", "marker.txt");
    await writeFile(marker, "expected");
    assert.equal(await verifyMarker(marker, "expected"), true);
    assert.equal(await verifyMarker(marker, "other"), false);
    const alias = join(root, "alias.txt");
    await link(marker, alias);
    assert.equal(await verifyMarker(marker, "expected"), false);
    await rm(alias);
    if (process.platform !== "win32") {
      await symlink(marker, alias);
      assert.equal(await verifyMarker(alias, "expected"), false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
