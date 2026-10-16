import assert from "node:assert/strict";
import test from "node:test";
import { verifyPublishedPackage } from "./verify-published-package.mjs";

const release = {
  name: "@potential-guide/effects",
  version: "0.1.0-rc.0",
  distTag: "rc",
  expectedLatest: "0.0.0",
  sourceCommit: "a".repeat(40),
  verificationCommit: "b".repeat(40),
};

function published() {
  return {
    name: release.name,
    "dist-tags": { latest: "0.0.0", rc: release.version },
    versions: {
      [release.version]: {
        name: release.name,
        version: release.version,
        dist: {
          integrity: "sha512-fixture-integrity",
          attestations: { url: "https://registry.example.test/attestations/fixture" },
        },
      },
    },
  };
}

test("published verification waits for propagation without repeating a publish", async () => {
  let reads = 0;
  const waits = [];
  const responses = [
    new Response(null, { status: 404 }),
    new Response(null, { status: 503 }),
    Response.json({ name: release.name, versions: {}, "dist-tags": { latest: "0.0.0" } }),
    Response.json(published()),
  ];
  const receipt = await verifyPublishedPackage(
    release,
    async () => {
      reads++;
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    async (milliseconds) => {
      waits.push(milliseconds);
    },
  );
  assert.equal(reads, 4);
  assert.deepEqual(waits, [5_000, 5_000, 5_000]);
  assert.equal(receipt.commit, release.sourceCommit);
  assert.equal(receipt.verificationCommit, release.verificationCommit);
  assert.equal(receipt.integrity, "sha512-fixture-integrity");
  assert.equal(receipt.tags.rc, release.version);
});

test("provenance and the intended RC tag must be present before success", async () => {
  const missing = published();
  delete missing.versions[release.version].dist.attestations;
  const responses = [Response.json(missing), Response.json(published())];
  let waits = 0;
  await verifyPublishedPackage(
    release,
    async () => {
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    async () => {
      waits++;
    },
  );
  assert.equal(waits, 1);
});

test("permanent registry errors and changed latest are not masked by retries", async () => {
  let reads = 0;
  const pause = async () => assert.fail("Permanent errors must not be retried.");
  await assert.rejects(
    verifyPublishedPackage(
      release,
      async () => {
        reads++;
        return new Response(null, { status: 403 });
      },
      pause,
    ),
    /HTTP 403/,
  );
  assert.equal(reads, 1);
  const changed = published();
  changed["dist-tags"].latest = release.version;
  await assert.rejects(
    verifyPublishedPackage(release, async () => Response.json(changed), pause),
    /RC must not change latest/,
  );
});

test("propagation waiting is bounded and a missing version never becomes success", async () => {
  let reads = 0;
  let waits = 0;
  await assert.rejects(
    verifyPublishedPackage(
      release,
      async () => {
        reads++;
        return new Response(null, { status: 404 });
      },
      async () => {
        waits++;
      },
    ),
    /not visible after 12 attempts/,
  );
  assert.equal(reads, 12);
  assert.equal(waits, 11);
});
