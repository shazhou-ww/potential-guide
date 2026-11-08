import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { fileSymlink } from "./file-symlink.js";

test("file symlink fixture attempts creation and does not skip a supported host", async (t) => {
  const calls: unknown[][] = [];
  t.mock.method(fs, "symlink", async (...args: unknown[]) => {
    calls.push(args);
  });
  assert.equal(
    await fileSymlink({ skip: () => assert.fail("Unexpected skip") }, "target", "alias"),
    true,
  );
  assert.deepEqual(calls, [["target", "alias", "file"]]);
});

for (const code of ["EPERM", "EACCES", "ENOENT", "EEXIST", "EIO"])
  test(`file symlink fixture handles ${code} without hiding unrelated failures`, async (t) => {
    const error = Object.assign(new Error("Fixture creation failed"), { code });
    t.mock.method(fs, "symlink", async () => {
      throw error;
    });
    const reasons: string[] = [];
    const context = { skip: (reason?: string) => reasons.push(reason ?? "") };
    if (process.platform === "win32" && ["EPERM", "EACCES"].includes(code)) {
      assert.equal(await fileSymlink(context, "target", "alias"), false);
      assert.equal(reasons.length, 1);
      assert.match(reasons[0]!, new RegExp(code));
      assert.match(reasons[0]!, /Developer Mode/);
    } else {
      await assert.rejects(fileSymlink(context, "target", "alias"), (actual) => actual === error);
      assert.deepEqual(reasons, []);
    }
  });
