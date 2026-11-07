import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertImmutableSchemas, collectSchemas, schemaBase } from "./publish-schemas.mjs";

test("retired Checker and Objective schemas retain their immutable canonical contents", async () => {
  const schemas = await collectSchemas(fileURLToPath(new URL("..", import.meta.url)));
  for (const [kind, digest] of [
    ["checker", "d1812f0a7c922ea48727e75b15c80e456a6932c3b7986bd9541eb3b61c1bd304"],
    ["objective", "bf2b5594d8ba3f360f7589aef6ea60e10d56ecd5e39d616386804a3d82a44699"],
  ]) {
    const bytes = schemas.get(`schemas/artifacts/${kind}/v1.json`);
    assert.ok(bytes, `Missing historical ${kind} schema.`);
    assert.equal(
      createHash("sha256").update(bytes.toString("utf8").replaceAll("\r\n", "\n")).digest("hex"),
      digest,
    );
  }
});

test("immutable publication permits new URIs, rejects modifications, deletions and unavailable hosting", async () => {
  const path = "schemas/objective/v1.json";
  const bytes = Buffer.from('{"immutable":true}\n');
  const schemas = new Map([[path, bytes]]);
  const request = async (url) => {
    const resource = url.slice(schemaBase.length);
    return resource === "schemas/index.json"
      ? new Response(JSON.stringify([path]))
      : new Response(bytes);
  };
  await assertImmutableSchemas(schemas, request);
  await assertImmutableSchemas(schemas, async () => new Response("", { status: 404 }));
  await assert.rejects(
    assertImmutableSchemas(new Map([[path, Buffer.from("{}")]]), request),
    /immutable/,
  );
  await assert.rejects(assertImmutableSchemas(new Map(), request), /remove published/);
  await assert.rejects(
    assertImmutableSchemas(schemas, async (url) =>
      url.endsWith("index.json")
        ? new Response(JSON.stringify([path]))
        : new Response("", { status: 404 }),
    ),
    /unavailable/,
  );
  await assert.rejects(
    assertImmutableSchemas(schemas, async () => new Response("", { status: 503 })),
    /HTTP 503/,
  );
});

test("schema sources identify exact canonical Draft 2020-12 definitions", async () => {
  const schemas = await collectSchemas(fileURLToPath(new URL("..", import.meta.url)));
  assert.ok(schemas.has("schemas/objective/v1.json"));
  assert.ok(schemas.has("schemas/objective/v2.json"));
  assert.ok(schemas.has("schemas/objective/v3.json"));
  assert.ok(schemas.has("schemas/objectives/v1.json"));
  assert.ok(schemas.has("schemas/artifacts/checker/v1.json"));
  assert.ok(schemas.has("schemas/artifacts/objective/v1.json"));
  assert.ok(schemas.has("schemas/artifacts/task/v1.json"));
  assert.equal(schemas.has("schemas/artifacts/task/v2.json"), false);
  const request = async (url) => {
    const path = url.slice(schemaBase.length);
    return path === "schemas/index.json"
      ? new Response(JSON.stringify([...schemas.keys()]))
      : new Response(schemas.get(path));
  };
  await assertImmutableSchemas(schemas, request);
  for (const path of schemas.keys()) {
    const changed = new Map(schemas);
    changed.set(path, Buffer.from("{}"));
    await assert.rejects(assertImmutableSchemas(changed, request), /immutable/);
  }
});
