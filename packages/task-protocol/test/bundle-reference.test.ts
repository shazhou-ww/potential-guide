import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBundleReference,
  parseBundleReference,
  TaskError,
  validateBundleReference,
} from "../src/index.js";

const digest = `sha256:${"a".repeat(64)}`;

test("Bundle reference helpers preserve retrieval URLs and full tree Digests", () => {
  for (const url of [
    "https://example.test/task.tar.gz?version=1&name=a%23b",
    "http://localhost:3000/task",
    "file:///D:/bundles/task.tar.gz",
    "file://localhost/D:/bundles/task.tar.gz",
    "HTTPS://EXAMPLE.test:443/a%2fb",
  ]) {
    const bundle = { url, digest };
    const reference = `${url}#${digest}`;
    assert.equal(formatBundleReference(bundle), reference);
    assert.deepEqual(parseBundleReference(reference), bundle);
    assert.equal(formatBundleReference(parseBundleReference(reference)), reference);
  }
  assert.equal(
    parseBundleReference(`https://mirror.test/task#${digest}`).digest,
    parseBundleReference(`https://origin.test/task#${digest}`).digest,
  );
});

test("Bundle reference helpers reject incomplete, ambiguous and unsupported references", () => {
  const invalid = (error: unknown) =>
    error instanceof TaskError && error.code === "invalid_request";
  for (const reference of [
    "",
    "https://example.test/task",
    `#${digest}`,
    "https://example.test/task#",
    `https://example.test/task#section#${digest}`,
    `https://example.test/task##${digest}`,
    `https://example.test/task#${digest}#`,
    `https://example.test/task#${digest.toUpperCase()}`,
    `https://example.test/task#sha256:${"a".repeat(63)}`,
    `https://example.test/task#sha256%3A${"a".repeat(64)}`,
    `https://user:password@example.test/task#${digest}`,
    `ftp://example.test/task#${digest}`,
    `file://remote/D:/task#${digest}`,
    `file:///D:/task?version=1#${digest}`,
    `${"https://example.test/"}${"a".repeat(4096)}#${digest}`,
  ])
    assert.throws(() => parseBundleReference(reference), invalid, reference);
  for (const url of ["https://example.test/task#", "https://example.test/task#section"]) {
    assert.throws(() => validateBundleReference({ url, digest }), invalid);
    assert.throws(() => formatBundleReference({ url, digest }), invalid);
  }
  assert.throws(() => parseBundleReference(null as never), invalid);
  assert.throws(
    () => formatBundleReference({ url: "https://example.test/task", digest: "" }),
    invalid,
  );
});
