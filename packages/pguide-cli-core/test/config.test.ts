import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  atomicWrite,
  digestTree,
  loadConfig,
  parseConfig,
  pruneExpiredRegulations,
  redactSensitive,
  validateAgentProfile,
} from "@potential-guide/cli-core";

test("configuration validates ACP profiles and rejects secret literals", () => {
  const profile = validateAgentProfile({
    connection: { type: "acp", protocolVersion: "1" },
    transport: { type: "stdio", command: "fixture", args: ["--acp"], env: ["TEST_TOKEN"] },
    requirements: { sessionResume: true },
  });
  assert.equal(profile.connection.type, "acp");
  assert.throws(() => parseConfig("schemaVersion: 1\npassword: literal\n"));
  assert.throws(() =>
    validateAgentProfile({
      connection: { type: "acp", protocolVersion: "1" },
      transport: { type: "stdio", command: "fixture", token: "literal" },
    }),
  );
  for (const name of [
    "api-key",
    "client-secret",
    "bearer-token",
    "authorization",
    "access-token",
    "refresh-token",
    "private-key",
    "credential",
    "token",
    "password",
  ]) {
    for (const args of [[`--${name}`, "literal"], [`--${name}=literal`]]) {
      assert.throws(() =>
        validateAgentProfile({
          connection: { type: "acp", protocolVersion: "1" },
          transport: { type: "stdio", command: "fixture", args },
        }),
      );
    }
  }
  for (const args of [["--api-key", "literal"], ["--token=literal"], ["--password", "literal"]]) {
    assert.throws(() =>
      validateAgentProfile({
        connection: { type: "acp", protocolVersion: "1" },
        transport: { type: "stdio", command: "fixture", args },
      }),
    );
  }
  assert.doesNotThrow(() =>
    validateAgentProfile({
      connection: { type: "acp", protocolVersion: "1" },
      transport: {
        type: "stdio",
        command: "fixture",
        args: ["--tokenizer", "fast", "--api-key-env", "SERVICE_API_KEY"],
        env: ["SERVICE_API_KEY"],
      },
    }),
  );
  assert.deepEqual(
    redactSensitive({
      nested: { credential: "hidden" },
      transport: {
        args: ["--client-secret=hidden", "--authorization", "hidden", "--tokenizer", "safe"],
      },
    }),
    {
      nested: { credential: "[REDACTED]" },
      transport: {
        args: [
          "--client-secret=[REDACTED]",
          "--authorization",
          "[REDACTED]",
          "--tokenizer",
          "safe",
        ],
      },
    },
  );
});

test("explicit configuration merges profiles by whole profile and atomic writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pguide-config-"));
  try {
    const path = join(root, "config.yaml");
    await atomicWrite(
      path,
      "schemaVersion: 1\ndefaultAgent: fixture\nagents:\n  fixture:\n    connection: {type: acp, protocolVersion: '1'}\n    transport: {type: stdio, command: fixture}\n",
    );
    const loaded = await loadConfig(root, path);
    assert.equal(loaded.value.defaultAgent, "fixture");
    assert.equal(loaded.sources["agents.fixture"], path);
    await writeFile(join(root, "bad.yaml"), "schemaVersion: 2\n");
    await assert.rejects(loadConfig(root, join(root, "bad.yaml")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Guide tree revisions cover checks and references with stable paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "pguide-guide-revision-"));
  try {
    const manifest = join(root, "objective-guide.yaml");
    const check = join(root, "checks", "ready", "run.js");
    const reference = join(root, "references", "levels", "initial", "en-US.md");
    const prerequisiteRoot = join(dirname(root), `${root.split(/[\\/]/).at(-1)}-prerequisite`);
    const prerequisiteManifest = join(prerequisiteRoot, "objective-guide.yaml");
    await mkdir(join(root, "checks", "ready"), { recursive: true });
    await mkdir(join(root, "references", "levels", "initial"), { recursive: true });
    await mkdir(prerequisiteRoot);
    await writeFile(
      manifest,
      `schemaVersion: 1\nprerequisite:\n  manifestUri: ${JSON.stringify(prerequisiteManifest)}\n`,
    );
    await writeFile(prerequisiteManifest, "schemaVersion: 1\n");
    await writeFile(check, "first");
    await writeFile(reference, "reference one");
    const first = await digestTree(manifest);
    await writeFile(check, "second");
    const second = await digestTree(manifest);
    await writeFile(reference, "reference two");
    const third = await digestTree(manifest);
    await writeFile(prerequisiteManifest, "schemaVersion: 1\nchanged: true\n");
    const fourth = await digestTree(manifest);
    assert.notEqual(first, second);
    assert.notEqual(second, third);
    assert.notEqual(third, fourth);
    if (process.platform !== "win32") {
      await symlink(join(root, "outside"), join(root, "references", "escape"));
      await assert.rejects(digestTree(manifest), /symbolic links/);
    }
  } finally {
    const prerequisiteRoot = join(dirname(root), `${root.split(/[\\/]/).at(-1)}-prerequisite`);
    await rm(prerequisiteRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("retention pruning removes only expired in-root Regulation directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "pguide-retention-"));
  const outside = await mkdtemp(join(tmpdir(), "pguide-retention-outside-"));
  try {
    const regulations = join(root, "regulations");
    const expired = join(regulations, "11111111-1111-4111-8111-111111111111");
    const current = join(regulations, "22222222-2222-4222-8222-222222222222");
    await mkdir(expired, { recursive: true });
    await mkdir(current, { recursive: true });
    await writeFile(
      join(expired, "regulation.json"),
      JSON.stringify({ expiresAt: "2020-01-01T00:00:00.000Z" }),
    );
    await writeFile(
      join(current, "regulation.json"),
      JSON.stringify({ expiresAt: "2099-01-01T00:00:00.000Z" }),
    );
    await writeFile(join(outside, "marker"), "safe");
    if (process.platform !== "win32") {
      await symlink(outside, join(regulations, "33333333-3333-4333-8333-333333333333"));
    }
    assert.equal(await pruneExpiredRegulations(root, new Date("2025-01-01T00:00:00Z")), 1);
    await assert.rejects(readFile(join(expired, "regulation.json")));
    assert.ok(await readFile(join(current, "regulation.json")));
    assert.equal(await readFile(join(outside, "marker"), "utf8"), "safe");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
