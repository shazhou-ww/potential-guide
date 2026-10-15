import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  atomicWrite,
  loadConfig,
  parseConfig,
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
