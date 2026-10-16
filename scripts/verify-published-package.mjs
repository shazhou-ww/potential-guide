import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseReleaseTag } from "./release-packages.mjs";

export async function verifyPublishedPackage(
  release,
  readPackage = () =>
    fetch(`https://registry.npmjs.org/${encodeURIComponent(release.name)}`, {
      headers: { accept: "application/json", "cache-control": "no-cache" },
      signal: AbortSignal.timeout(15_000),
    }),
  pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  const attempts = 60;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await readPackage();
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status !== 404 && response.status < 500) {
        throw new Error(`Registry metadata request failed with HTTP ${response.status}.`);
      }
    } else {
      const packument = await response.json();
      assert.equal(packument.name, release.name);
      const metadata = packument.versions?.[release.version];
      const tags = packument["dist-tags"] ?? {};
      if (
        metadata?.dist?.integrity &&
        metadata.dist.attestations?.url &&
        tags[release.distTag] === release.version
      ) {
        assert.equal(metadata.name, release.name);
        assert.equal(metadata.version, release.version);
        if (release.distTag === "rc") {
          assert.equal(tags.latest ?? "", release.expectedLatest, "RC must not change latest.");
        }
        return {
          package: release.name,
          version: release.version,
          tags,
          latestBefore: release.expectedLatest,
          commit: release.sourceCommit,
          verificationCommit: release.verificationCommit,
          integrity: metadata.dist.integrity,
          provenance: metadata.dist.attestations.url,
        };
      }
    }
    if (attempt < attempts) {
      process.stderr.write(
        `Waiting for ${release.name}@${release.version} registry propagation (${attempt}/${attempts}).\n`,
      );
      await pause(5_000);
    }
  }
  throw new Error(
    `${release.name}@${release.version} metadata, distribution tag or provenance is not visible after ${attempts} attempts.`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const release = parseReleaseTag(`${process.env.PACKAGE_ID}-v${process.env.PACKAGE_VERSION}`);
  assert.equal(release.name, process.env.PACKAGE_NAME);
  assert.equal(release.distTag, process.env.DIST_TAG);
  assert.ok(process.env.LATEST_BEFORE !== undefined, "The previous latest tag must be recorded.");
  const sourceCommit = execFileSync(
    "git",
    ["rev-parse", "--verify", `refs/tags/${release.id}-v${release.version}^{}`],
    { encoding: "utf8" },
  ).trim();
  const receipt = await verifyPublishedPackage({
    ...release,
    expectedLatest: process.env.LATEST_BEFORE,
    sourceCommit,
    verificationCommit: process.env.GITHUB_SHA,
  });
  console.log(JSON.stringify(receipt, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Published release receipt\n\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\`\n`,
    );
  }
}
