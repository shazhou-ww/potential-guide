import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { taskSchemaUri } from "@potential-guide/task-protocol";
import { buildTaskBundle, packTaskBundle } from "@potential-guide/task-sdk/build";
import { BundleCache, inspectTaskBundle } from "../src/bundle.js";

async function fixture(
  run: (fixture: {
    directory: string;
    archive: string;
    bytes: Buffer;
    digest: string;
  }) => Promise<void>,
) {
  const directory = resolve(".cache", `bundle-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const yaml = join(directory, "task.yaml");
    const callback = join(directory, "callback.ts");
    await writeFile(
      yaml,
      JSON.stringify({
        $schema: taskSchemaUri,
        name: "相同展示名称",
        runtime: { type: "node", minVersion: "22.13.0" },
        entry: "worker.cjs",
        inputSchema: { type: "object" },
        resultSchema: true,
        messageSchema: false,
      }),
    );
    await writeFile(callback, "export default async input => input;");
    const built = await buildTaskBundle({
      declaration: yaml,
      entry: callback,
      outDirectory: join(directory, "built"),
    });
    const packed = await packTaskBundle(built.directory, join(directory, "bundle.tar.gz"));
    await run({
      directory,
      archive: packed.archive,
      bytes: await readFile(packed.archive),
      digest: built.digest,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test("V02/B09: content cache shares preparation by Digest across URLs, pins active content and re-fetches only after eviction", async () => {
  await fixture(async ({ directory, bytes, digest }) => {
    let fetched = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher: typeof fetch = async () => {
      fetched++;
      await ready;
      return new Response(bytes);
    };
    const cache = new BundleCache({ directory: join(directory, "cache"), fetch: fetcher });
    try {
      const a = cache.acquire({ url: "https://example.test/a", digest });
      const b = cache.acquire({ url: "https://example.test/b", digest });
      assert.equal(await cache.evict(digest), false);
      assert.deepEqual((await cache.list({})).items, [
        { digest, cached: false, preparing: true, leases: 2 },
      ]);
      release();
      const [first, second] = await Promise.all([a, b]);
      assert.equal(fetched, 1);
      assert.equal(first.directory, second.directory);
      assert.equal(first.declaration.name, "相同展示名称");
      const detail = await cache.detail(digest);
      assert.equal(detail.name, "相同展示名称");
      assert.equal(detail.cached, true);
      assert.equal(detail.leases, 2);
      assert.ok(detail.bytes! > 0);
      assert.ok(detail.files! >= 2);
      assert.deepEqual(detail.declaration, first.declaration);
      assert.equal("directory" in detail, false);
      first.release();
      first.release();
      assert.equal(await cache.evict(digest), false);
      second.release();
      const cached = await cache.acquire({ url: "https://unavailable.test/never-fetched", digest });
      assert.equal(fetched, 1);
      cached.release();
      assert.equal(await cache.evict(digest), true);
      const refetched = await cache.acquire({ url: "https://example.test/original", digest });
      assert.equal(fetched, 2);
      assert.equal(refetched.digest, digest);
      refetched.release();
      await assert.rejects(
        cache.acquire({ url: "https://example.test/a", digest: `sha256:${"0".repeat(64)}` }),
        { code: "bundle_digest_mismatch" },
      );
      assert.equal(await cache.evict(`sha256:${"0".repeat(64)}`), true);
    } finally {
      await cache.close();
    }
  });
});
test("cache management enumerates persisted content, bounds pages and serializes acquisition behind eviction", async () => {
  await fixture(async ({ directory, bytes, digest }) => {
    let fetched = 0;
    const options = {
      directory: join(directory, "cache"),
      fetch: async () => {
        fetched++;
        return new Response(bytes);
      },
    };
    const cache = new BundleCache(options);
    const ref = { url: "https://example.test/bundle", digest };
    try {
      (await cache.acquire(ref)).release();
      const page = await cache.list({ limit: 1 });
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0]!.leases, 0);
      assert.equal((await cache.list({ after: digest })).items.length, 0);
      await assert.rejects(cache.list({ limit: 0 }), { code: "invalid_request" });
      await assert.rejects(cache.list({ limit: 101 }), { code: "invalid_request" });
      await assert.rejects(cache.list({ after: "../outside" }), { code: "invalid_request" });
      await assert.rejects(cache.detail(`sha256:${"0".repeat(64)}`), { code: "not_found" });
      const reopened = new BundleCache(options);
      try {
        assert.equal((await reopened.list({})).items[0]!.digest, digest);
      } finally {
        await reopened.close();
      }
      await writeFile(
        join(directory, "callback.ts"),
        "export default async input => ({other:input});",
      );
      const another = await buildTaskBundle({
        declaration: join(directory, "task.yaml"),
        entry: join(directory, "callback.ts"),
        outDirectory: join(directory, "another"),
      });
      const anotherArchive = await packTaskBundle(
        another.directory,
        join(directory, "another.tar.gz"),
      );
      (
        await cache.acquire({
          url: pathToFileURL(anotherArchive.archive).href,
          digest: another.digest,
        })
      ).release();
      const firstPage = await cache.list({ limit: 1 });
      assert.equal(firstPage.next, firstPage.items[0]!.digest);
      const nextPage = await cache.list({ limit: 1, after: firstPage.next });
      assert.deepEqual(
        [...firstPage.items, ...nextPage.items].map((item) => item.digest),
        [digest, another.digest].sort(),
      );
      assert.equal(nextPage.next, undefined);
      assert.equal(await cache.evict(another.digest), true);
      const removed = cache.evict(digest);
      const acquiring = cache.acquire(ref);
      assert.equal(await removed, true);
      const acquired = await acquiring;
      assert.equal(fetched, 2, "acquisition must wait for eviction then fetch valid content");
      assert.equal(acquired.digest, digest);
      assert.equal(await cache.evict(digest), false);
      acquired.release();
      assert.equal(await cache.evict(digest), true);
      assert.deepEqual((await cache.list({})).items, []);
      assert.equal(
        await readFile(join(directory, "bundle.tar.gz")).then((data) => data.length),
        bytes.length,
      );
    } finally {
      await cache.close();
    }
  });
});
test("V02: cached content obeys the current host capacity and every reference still requires URL plus Digest", async () => {
  await fixture(async ({ directory, archive, digest }) => {
    const root = join(directory, "cache");
    const cache = new BundleCache({ directory: root });
    const first = await cache.acquire({ url: pathToFileURL(archive).href, digest });
    first.release();
    await cache.close();
    const stricter = new BundleCache({ directory: root, limits: { fileBytes: 16 } });
    try {
      await assert.rejects(stricter.acquire({ url: "https://unavailable.test/not-used", digest }));
      await assert.rejects(stricter.acquire({ digest } as never), { code: "invalid_request" });
      await assert.rejects(stricter.acquire({ url: pathToFileURL(archive).href } as never), {
        code: "invalid_request",
      });
    } finally {
      await stricter.close();
    }
    const damaged = new BundleCache({ directory: root });
    try {
      await chmod(join(first.directory, "worker.cjs"), 0o600);
      await writeFile(join(first.directory, "worker.cjs"), "tampered", { mode: 0o600 });
      await assert.rejects(damaged.acquire({ url: pathToFileURL(archive).href, digest }), {
        code: "bundle_digest_mismatch",
      });
      assert.equal(await damaged.evict(digest), true);
      const restored = await damaged.acquire({ url: pathToFileURL(archive).href, digest });
      assert.equal(restored.digest, digest);
      restored.release();
    } finally {
      await damaged.close();
    }
  });
});
test("V02: Bundle logical roots are exact; no outer directory, runtime change or unknown protocol is repaired", () => {
  const declaration = {
    $schema: taskSchemaUri,
    name: "same name",
    runtime: { type: "node", minVersion: "22.13.0" },
    entry: "worker.cjs",
    inputSchema: { type: "object" },
    resultSchema: true,
    messageSchema: false,
  };
  const files = (value: unknown) =>
    new Map([
      ["task.yaml", Buffer.from(JSON.stringify(value))],
      ["worker.cjs", Buffer.from("code")],
    ]);
  assert.equal(inspectTaskBundle(files(declaration)).declaration.$schema, taskSchemaUri);
  for (const version of ["v2", "v3"])
    assert.throws(
      () =>
        inspectTaskBundle(files({ ...declaration, $schema: taskSchemaUri.replace("v1", version) })),
      { code: "invalid_bundle" },
    );
  assert.throws(() => inspectTaskBundle(new Map([["outer/task.yaml", Buffer.from("x")]])), {
    code: "invalid_bundle",
  });
  assert.throws(
    () => inspectTaskBundle(files({ ...declaration, $schema: `${taskSchemaUri}?unsupported` })),
    { code: "invalid_bundle" },
  );
  assert.throws(
    () =>
      inspectTaskBundle(
        files({ ...declaration, runtime: { type: "node", minVersion: "999.0.0" } }),
      ),
    { code: "unsupported_runtime" },
  );
  const extra = files(declaration);
  extra.set("node_modules/code.js", Buffer.from("code"));
  assert.throws(() => inspectTaskBundle(extra), { code: "invalid_bundle" });
});
test("V05: host concurrency queues distinct Digests without a deadline and shutdown releases active and queued acquisition", {
  timeout: 5000,
}, async () => {
  await fixture(async ({ directory, digest }) => {
    let fetched = 0;
    const cache = new BundleCache({
      directory: join(directory, "cache"),
      concurrency: 1,
      fetch: async (_url, init) => {
        fetched++;
        init!.signal!.throwIfAborted();
        return new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {
            once: true,
          });
        });
      },
    });
    const secondDigest = `sha256:${"0".repeat(64)}`;
    const first = cache.acquire({ url: "https://example.test/first", digest });
    const second = cache.acquire({ url: "https://example.test/second", digest: secondDigest });
    const settled = Promise.allSettled([first, second]);
    while (!fetched) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(fetched, 1);
    await cache.close();
    const results = await settled;
    assert.ok(
      results.every(
        (result) => result.status === "rejected" && result.reason.code === "engine_closed",
      ),
    );
    assert.equal(await cache.evict(digest), true);
    assert.equal(await cache.evict(secondDigest), true);
  });
});
test("V05 loader boundary: only host shutdown aborts shared fetching; no preparation deadline is introduced", async () => {
  await fixture(async ({ directory, digest }) => {
    const cache = new BundleCache({
      directory: join(directory, "cache"),
      fetch: async (_url, init) => {
        init!.signal!.throwIfAborted();
        return new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {
            once: true,
          });
        });
      },
    });
    const pending = cache.acquire({ url: "https://example.test/slow", digest });
    const rejected = assert.rejects(pending, { code: "engine_closed" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await cache.close();
    await rejected;
    await assert.rejects(cache.acquire({ url: "https://example.test/slow", digest }), {
      code: "engine_closed",
    });
  });
});
