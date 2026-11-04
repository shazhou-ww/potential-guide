import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as runtime from "../src/index.js";

test("SDK exposes only the Worker runtime and depends only on the protocol", async () => {
  assert.deepEqual(Object.keys(runtime).sort(), ["RunFailure", "runTask"]);
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(manifest.exports), ["."]);
  assert.deepEqual(manifest.dependencies, { "@potential-guide/task-protocol": "workspace:^" });
});
