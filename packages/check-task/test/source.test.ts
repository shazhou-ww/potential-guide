import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkerSchemaUri, inspectContractFiles } from "@potential-guide/check-artifacts/contracts";
import {
  packContractArtifact,
  writeContractArtifact,
} from "@potential-guide/check-artifacts/build";
import { createArtifactSource } from "../src/index.js";

test("exact cache hits reauthorize source/scope; mismatch, corruption and denied origins remain explicit", async () => {
  const root = resolve(".cache", `check-source-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const files = new Map([
    [
      "checker.yaml",
      Buffer.from(
        JSON.stringify({
          $schema: checkerSchemaUri,
          runtime: { type: "node", minVersion: "22.13.0" },
          entry: "checker.cjs",
          subjectSchema: { type: "object" },
          languages: ["en"],
          problems: [],
        }),
      ),
    ],
    ["checker.cjs", Buffer.from("exports.execute=()=>{}")],
    ["references/en/checker.md", Buffer.from("---\ntitle: Check\ndescription: Check\n---\nBody\n")],
  ]);
  const artifact = inspectContractFiles(files);
  let allowed = true;
  let downloads = 0;
  let authorizations = 0;
  let bytes: Buffer;
  const source = createArtifactSource({
    allowedOrigins: ["https://example.test"],
    authorize(_reference, scope) {
      authorizations++;
      if (!allowed || scope !== "allowed") throw new Error("denied");
    },
    async download() {
      downloads++;
      return bytes;
    },
  });
  const reference = {
    kind: "checker" as const,
    url: "https://example.test/checker.tgz",
    digest: artifact.digest,
  };
  try {
    const built = await writeContractArtifact(files, join(root, "artifact"));
    const packed = await packContractArtifact(built.directory, join(root, "artifact.tgz"));
    bytes = await readFile(packed.archive);
    const signal = new AbortController().signal;
    const first = await source.resolve(reference, "allowed", signal);
    first.files.get("checker.cjs")!.fill(0);
    assert.equal((await source.resolve(reference, "allowed", signal)).digest, artifact.digest);
    assert.equal(downloads, 1);
    assert.equal(authorizations, 2);
    allowed = false;
    await assert.rejects(source.resolve(reference, "allowed", signal), /denied/);
    allowed = true;
    await assert.rejects(source.resolve(reference, "other", signal), /denied/);
    await assert.rejects(
      source.resolve({ ...reference, url: "https://other.test/x" }, "allowed", signal),
      /origin/,
    );
    await assert.rejects(
      source.resolve({ ...reference, digest: `sha256:${"0".repeat(64)}` }, "allowed", signal),
      /digest/,
    );
    bytes = Buffer.from("not an archive");
    await assert.rejects(
      source.resolve({ ...reference, url: "https://example.test/bad" }, "allowed", signal),
      /invalid/,
    );
  } finally {
    await source.close();
    await rm(root, { recursive: true, force: true });
  }
});
