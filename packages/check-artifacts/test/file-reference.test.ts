import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  checkerSchemaUri,
  objectiveSchemaUri,
  formatArtifactReference,
  parseArtifactReference,
  parseFileArtifactUrl,
  validateArtifactReference,
  parseObjectiveArtifactManifest,
  parseCheckerResult,
  type CheckerManifest,
} from "../src/pure.js";

test("direct Checker file references roundtrip canonically without filesystem availability", () => {
  const path = resolve(".cache", "不存在 archive #1.tgz");
  const url = pathToFileURL(path).href;
  assert.equal(parseFileArtifactUrl(url), path);
  for (const reference of [
    { kind: "checker" as const, url },
    { kind: "checker" as const, url, digest: `sha256:${"a".repeat(64)}` },
    {
      kind: "checker" as const,
      url: "https://example.test/a.tgz",
      digest: `sha256:${"b".repeat(64)}`,
    },
  ])
    assert.deepEqual(parseArtifactReference(formatArtifactReference(reference)), reference);
});
test("file URL syntax rejects credentials, hosts, query, fragments and noncanonical or ambiguous paths", () => {
  const valid = pathToFileURL(resolve(".cache", "archive.tgz")).href;
  for (const url of [
    "file:archive.tgz",
    "file:/archive.tgz",
    "file://localhost/archive.tgz",
    "file://server/share/archive.tgz",
    "file:////server/share/archive.tgz",
    "file://user:pass@server/archive.tgz",
    `${valid}?`,
    `${valid}/`,
    `${valid}?token=x`,
    `${valid}#`,
    `${valid}#sha256:${"a".repeat(64)}`,
    valid.replace("archive", "%61rchive"),
    valid.replace("archive", "../archive"),
    valid.replace("archive", "%2e%2e/archive"),
    valid.replace("archive", "%2Farchive"),
    valid.replace("archive", "%00archive"),
    valid.replace("archive", "%5Carchive"),
    valid.replace("archive", "a%0Ab"),
  ])
    assert.throws(() => validateArtifactReference({ kind: "checker", url }), url);
  if (process.platform === "win32") {
    for (const path of [
      "file:///C:/root/CON",
      "file:///C:/root/a:stream",
      "file:///C:/root/a.",
      "file:///C:/root/a%20",
      "file:///C:/root/CONIN$",
      "file:///C:/root/COM%C2%B9",
    ])
      assert.throws(() => parseFileArtifactUrl(path));
  }
});
test("Objective embedded Checker URLs and dependency Objective references remain HTTPS-only", () => {
  const url = pathToFileURL(resolve(".cache", "archive.tgz")).href;
  assert.throws(() => validateArtifactReference({ kind: "objective", url }));
  assert.throws(() => parseArtifactReference(`objective:${url}`));
  const objective = {
    $schema: objectiveSchemaUri,
    subjectSchema: { type: "object" },
    languages: ["en"],
    levels: [{ id: "ready", checks: ["check"] }],
    checkers: { check: { url, digest: `sha256:${"a".repeat(64)}`, subjectMapping: "$" } },
  };
  assert.throws(
    () => parseObjectiveArtifactManifest(Buffer.from(JSON.stringify(objective))),
    /HTTPS/,
  );
  assert.throws(() =>
    parseCheckerResult(
      {
        status: 200,
        message: "",
        payload: {
          ok: false,
          problems: [],
          requirements: [
            { objective: { kind: "objective", url }, subject: {}, expectedLevelId: "ready" },
          ],
        },
      },
      { $schema: checkerSchemaUri, problems: [] } as unknown as CheckerManifest,
    ),
  );
});
