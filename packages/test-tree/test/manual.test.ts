import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadTree, paths } from "../src/model.js";

const root = resolve("..", "..");
const loaded = await loadTree(resolve("test", "check-host", "host.states.yaml"));
function commands(text: string): string {
  return [...text.matchAll(/^```js\n([\s\S]*?)^```/gm)].map((match) => match[1]).join("\n");
}
test("human instructions use only public Check Host APIs and transparent business input", () => {
  for (const path of paths(loaded.tree)) {
    const text = [
      ...path.states.flatMap((state) => [state.before, state.after]),
      path.check.doc,
    ].join("\n");
    const code = commands(text);
    assert.ok(!/manual\.ts|host\.binding|test-tree|tsx|SCENARIO_DIRECTORY|\$case/.test(code));
    assert.ok(!text.includes("```powershell"));
    assert.ok(code.includes('import("./packages/check-host/dist/index.js")'));
  }
});
test("raw documented Node commands reproduce each state without test bindings or manual helpers", () => {
  for (const path of paths(loaded.tree)) {
    const enter = path.states.map((state) => {
      const code = commands(state.before);
      if (state.id === "running")
        return `${code}
          for (let attempt = 0;; attempt++) {
            const snapshot = await client.sample("held");
            if (snapshot.state === "Running" && snapshot.progress) break;
            if (attempt > 500) throw new Error("Running observation never arrived");
            await new Promise(resolve => setTimeout(resolve, 20));
          }`;
      if (state.id === "cancelling")
        return `${code}
          for (let attempt = 0;; attempt++) {
            if ((await fs.readdir(controls)).includes("cleaning")) break;
            if (attempt > 500) throw new Error("Cleaning observation never arrived");
            await new Promise(resolve => setTimeout(resolve, 20));
          }`;
      return code;
    });
    const cleanup = [...path.states]
      .reverse()
      .map((state) => commands(state.after))
      .filter(Boolean)
      .map((code) => `try { ${code} } catch (error) { cleanupErrors.push(error); }`)
      .join("\n");
    const script = `
      ${enter[0]}
      const cleanupErrors = [];
      try {
        ${enter.slice(1).join("\n")}
        ${commands(path.check.doc)}
        console.log("__OBSERVED__", JSON.stringify({
          states: await Promise.all(["held","fault","recovery"].map(async id => {
            try { return await client.sample(id); }
            catch (error) { if (error.status === 404) return null; throw error; }
          })),
          files: await fs.readdir(controls),
          active: await (await fetch(host.endpoint + "/checks", { headers })).json()
        }));
      } finally {
        ${cleanup}
        if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Manual cleanup failed");
      }
    `;
    const result = spawnSync(process.execPath, ["--input-type=module"], {
      cwd: root,
      input: script,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(result.status, 0, `${path.id}: ${result.stdout}\n${result.stderr}`);
    const output = result.stdout.split("\n").find((line) => line.startsWith("__OBSERVED__ "));
    assert.ok(output, result.stdout);
    const observed = JSON.parse(output.slice("__OBSERVED__ ".length)) as {
      states: ({ state: string; error?: string; progress?: unknown; result?: unknown } | null)[];
      files: string[];
      active: unknown[];
    };
    const [held, fault, recovered] = observed.states;
    switch (path.states.at(-1)?.id) {
      case "ready":
        assert.deepEqual(observed.active, []);
        break;
      case "running":
        assert.ok(held && held.state === "Running");
        assert.deepEqual(held.progress, { entered: true, marker: "tree-manual", calls: 1 });
        assert.equal(observed.active.length, 1);
        break;
      case "cancelling":
        assert.equal(held?.state, "Cancelling");
        assert.ok(observed.files.includes("cleaning") && !observed.files.includes("cleaned"));
        break;
      case "cancelled":
        assert.equal(held?.state, "Cancelled");
        assert.ok(observed.files.includes("cleaned"));
        assert.deepEqual(observed.active, []);
        break;
      case "faulted":
      case "recovered":
        assert.ok(fault && fault.state === "Failed");
        assert.equal(fault.error, "Error: manual injected failure");
        assert.deepEqual(observed.active, []);
        if (path.states.at(-1)?.id === "recovered") {
          assert.ok(recovered && recovered.state === "Completed");
          assert.deepEqual(recovered.result, { marker: "tree-manual", calls: 2 });
        }
        break;
      default:
        assert.fail(`Unverified manual state ${path.id}`);
    }
  }
});
