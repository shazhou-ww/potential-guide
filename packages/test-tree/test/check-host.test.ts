import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CheckClient, type CheckState } from "@potential-guide/check-host";
import { loadTree } from "../src/model.js";
import { registerTests } from "../src/runner.js";
import { Context, inspect } from "./check-host/scenario.js";

await registerTests(
  await loadTree(fileURLToPath(new URL("./check-host/host.states.yaml", import.meta.url))),
  () => new Context(),
  (file) => import(pathToFileURL(file).href),
);

test("recovered probe rejects rewritten fault state or original injected error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json([]));
  const invalid: CheckState[] = [
    { checkId: "fault", state: "Completed", result: {} },
    { checkId: "fault", state: "Failed", error: "Error: different failure" },
  ];
  for (const fault of invalid) {
    const context = new Context();
    context.client = new CheckClient({
      endpoint: "http://127.0.0.1:1",
      token: "probe-only",
      pid: process.pid,
      instance: "probe-only",
    });
    t.mock.method(
      context.client,
      "sample",
      async (id: string): Promise<CheckState> =>
        id === "fault"
          ? fault
          : {
              checkId: "recovery",
              state: "Completed",
              result: { marker: "tree-manual", calls: 2 },
            },
    );
    await assert.rejects(inspect(context, "recovered"), assert.AssertionError);
  }
});
