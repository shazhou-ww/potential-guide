import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { loadTree, parseTree, paths, skipReason } from "../src/model.js";
import { renderHtml, renderMarkdown, renderTerminal } from "../src/render.js";
import { executePath, validateBindings } from "../src/runner.js";

const source = `namespace: demo
binding: ./binding.ts
state:
  id: root
  title: Root
  before: enter root
  after: leave root
  checks:
    - id: parent
      title: Parent
      doc: parent-only probe
  states:
    - id: child
      title: Child
      before: enter child
      after: leave child
      checks:
        - id: probe
          title: Child probe
          doc: |
            \`\`\`powershell
            Write-Output '<script>alert("x")</script>'
            \`\`\`
`;
const loaded = () => ({
  file: resolve("tree.yaml"),
  bindingFile: resolve("binding.ts"),
  tree: parseTree(source),
});
function childPath() {
  const path = paths(parseTree(source))[1];
  assert.ok(path);
  return path;
}
async function fixture() {
  const scratch = resolve(".cache", "test-tree-unit");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "case-"));
  return {
    directory,
    close: () => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}
test("strict YAML rejects duplicate keys, IDs, unknown fields, missing prose and aliases", () => {
  const invalid = [
    source.replace("namespace: demo", "namespace: demo\nnamespace: again"),
    source.replace("id: child", "id: root"),
    source.replace("id: child", "id: child_state"),
    source.replace("id: probe", "id: 3probe"),
    source.replace("before: enter child", "before: ''"),
    source.replace("after: leave child", "after: null"),
    source.replace("title: Child", "typo: Child"),
    source.replace("title: Child", "title: !unknown Child"),
    source.replace("binding: ./binding.ts", "binding: https://example.com/binding.ts"),
    source.replace("binding: ./binding.ts", "binding: ./binding.js"),
    source.replace("id: child", "id: child\n      use: arbitrary"),
    source.replace("checks:\n    -", "checks: wrong\n    -"),
    source.replace("after: leave root", "after: leave root\n  platforms: [unknown]"),
    source.replace("after: leave root", "after: leave root\n  platforms: []"),
    source.replace("id: parent", "id: parent\n      doc: &alias sample\n    - id: parent"),
    source.replace("namespace: demo", "namespace: &ns demo").replace("title: Root", "title: *ns"),
  ];
  for (const value of invalid) assert.throws(() => parseTree(value), Error, value);
  assert.throws(
    () =>
      parseTree(
        source.replace(
          "doc: parent-only probe",
          "doc: parent-only probe\n    - id: parent\n      title: Repeated\n      doc: repeated",
        ),
      ),
    /duplicate check parent/,
  );
  assert.throws(() => parseTree("namespace: empty\nbinding: ./binding.ts\nstate: null"), /state/);
  assert.throws(() => parseTree(source.replace(/ {2}checks:[\s\S]*/, "")), /at least one check/);
});
test("relative binding, stable IDs, platform applicability and contextual data diagnostics", async () => {
  const f = await fixture();
  try {
    const file = join(f.directory, "tree.yaml");
    await writeFile(file, source);
    const tree = await loadTree(file);
    assert.equal(tree.bindingFile, join(f.directory, "binding.ts"));
    assert.deepEqual(
      paths(tree.tree).map((p) => p.id),
      ["root.parent", "child.probe"],
    );
    assert.deepEqual(
      paths(parseTree(source.replace("title: Child", "title: Renamed"))).map((p) => p.id),
      ["root.parent", "child.probe"],
    );
    const restricted = parseTree(source.replace("id: root", "id: root\n  platforms: [win32]"));
    const path = paths(restricted)[1];
    assert.ok(path);
    assert.match(skipReason(path, "linux") ?? "", /root: requires win32; current linux/);
    assert.equal(skipReason(path, "win32"), undefined);
    await writeFile(file, "bad: data");
    await assert.rejects(
      loadTree(file),
      (error: Error) => error.message.includes(file) && error.message.includes("unknown field"),
    );
  } finally {
    await f.close();
  }
});
test("each probe rebuilds context and full path, excludes parent probes and reverses cleanup", async () => {
  const log: string[] = [];
  const binding = {
    transition_root: (c: { value: number }) => {
      assert.equal(c.value, 0);
      c.value++;
      log.push("root");
      return () => {
        log.push("after root");
      };
    },
    transition_child: (c: { value: number }) => {
      assert.equal(c.value, 1);
      log.push("child");
      return () => {
        log.push("after child");
      };
    },
    check_root_parent: () => {
      throw new Error("parent probe must not run");
    },
    check_child_probe: () => {
      log.push("probe");
    },
  };
  validateBindings(loaded(), binding);
  for (let n = 0; n < 2; n++) await executePath(childPath(), binding, { value: 0 });
  assert.deepEqual(
    log,
    Array(2).fill(["root", "child", "probe", "after child", "after root"]).flat(),
  );
});
test("probe failure and multiple cleanup failures remain visible in order", async () => {
  const primary = new Error("probe failed");
  const child = new Error("child cleanup failed");
  const root = new Error("root cleanup failed");
  await assert.rejects(
    executePath(
      childPath(),
      {
        transition_root: () => () => {
          throw root;
        },
        transition_child: () => async () => {
          throw child;
        },
        check_child_probe: () => {
          throw primary;
        },
      },
      {},
    ),
    (error: AggregateError) => {
      assert.deepEqual(error.errors, [primary, child, root]);
      return true;
    },
  );
  await assert.rejects(
    executePath(
      childPath(),
      {
        transition_root: () => () => {
          throw root;
        },
        transition_child: () => () => {},
        check_child_probe: () => {},
      },
      {},
    ),
    (error) => error === root,
  );
});
test("transition owns partial initialization; ancestors clean even when transition never returns", async () => {
  const log: string[] = [];
  const failure = new Error("partial enter failed");
  await assert.rejects(
    executePath(
      childPath(),
      {
        transition_root: () => () => {
          log.push("ancestor clean");
        },
        transition_child: async () => {
          try {
            log.push("partial resource acquired");
            throw failure;
          } finally {
            log.push("partial resource clean");
          }
        },
        check_child_probe: () => {
          log.push("must not probe");
        },
      },
      {},
    ),
    (error) => error === failure,
  );
  assert.deepEqual(log, ["partial resource acquired", "partial resource clean", "ancestor clean"]);
  const transitionAndCleanup = new AggregateError([failure, new Error("partial cleanup failed")]);
  await assert.rejects(
    executePath(
      childPath(),
      {
        transition_root: () => () => {},
        transition_child: () => {
          throw transitionAndCleanup;
        },
      },
      {},
    ),
    (error) => error === transitionAndCleanup,
  );
});
test("missing and non-function exports are diagnosed before transitions; invalid after is not synthesized", async () => {
  let entered = false;
  assert.throws(
    () =>
      validateBindings(loaded(), {
        transition_root: () => {
          entered = true;
        },
        transition_child: 42,
      }),
    (error: Error) =>
      error.message.includes("state child") &&
      error.message.includes("transition_child") &&
      error.message.includes("check_child_probe") &&
      error.message.includes(loaded().bindingFile),
  );
  assert.equal(entered, false);
  const log: string[] = [];
  await assert.rejects(
    executePath(
      childPath(),
      {
        transition_root: () => () => {
          log.push("ancestor clean");
        },
        transition_child: () => undefined,
        check_child_probe: () => {
          log.push("must not probe");
        },
      },
      {},
    ),
    /state child: transition_child must return an after function/,
  );
  assert.deepEqual(log, ["ancestor clean"]);
});
test("three outputs show states and observations rather than per-test setup/teardown paths", () => {
  const tree = loaded();
  const terminal = renderTerminal(tree);
  const markdown = renderMarkdown(tree);
  const html = renderHtml(tree);
  for (const path of paths(tree.tree)) {
    for (const output of [terminal, markdown, html]) assert.ok(output.includes(path.id));
  }
  const child = markdown.slice(markdown.indexOf("## 状态：Child"));
  assert.ok(child.includes("enter child"));
  assert.ok(child.includes("leave child"));
  assert.ok(!child.includes("enter root"));
  assert.ok(!child.includes("parent-only probe"));
  assert.equal((html.match(/<article /g) ?? []).length, 2);
  assert.ok(html.includes('id="state-root"'));
  assert.ok(html.includes('id="state-child"'));
  assert.ok(html.includes('id="child.probe"'));
  assert.ok(html.includes("在此状态观察"));
  assert.ok(html.includes("可以转向的状态"));
  assert.ok(!/Enter \(root|Cleanup \(reverse|transition_|<h4>after /.test(html));
  assert.ok(markdown.includes("```powershell\nWrite-Output '<script>alert(\"x\")</script>'\n```"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("<details"));
  assert.ok(html.includes('href="#state-child"'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("Not run"));
  assert.ok(!/https?:\/\//.test(html));
  const restricted = {
    ...tree,
    tree: parseTree(source.replace("id: child", "id: child\n      platforms: [win32]")),
  };
  for (const output of [
    renderTerminal(restricted),
    renderMarkdown(restricted),
    renderHtml(restricted),
  ])
    assert.match(output, /win32/);
  const hostile = {
    ...tree,
    tree: parseTree(source.replace("namespace: demo", "namespace: '<img src=x onerror=alert(1)>'")),
  };
  assert.ok(!renderHtml(hostile).includes("<img"));
});
test("committed Host manuals are exact derivatives of the sole YAML", async () => {
  const tree = await loadTree(resolve("test", "check-host", "host.states.yaml"));
  assert.equal(
    await readFile(resolve("..", "..", "docs", "check-host-manual.md"), "utf8"),
    renderMarkdown(tree),
  );
  assert.equal(
    await readFile(resolve("..", "..", "docs", "check-host-manual.html"), "utf8"),
    renderHtml(tree),
  );
});
test("platform instructions are strict, escaped collapsibles within human state articles", () => {
  const tree = parseTree(source);
  tree.state.before = {
    posix: "```bash\ncurl --fail 'http://127.0.0.1'\n```\n<script>unsafe</script>",
    powershell: "```powershell\nInvoke-RestMethod 'http://127.0.0.1'\n```",
  };
  const parsed = { ...loaded(), tree: parseTree(JSON.stringify(tree)) };
  const html = renderHtml(parsed);
  const markdown = renderMarkdown(parsed);
  for (const output of [html, markdown]) {
    assert.ok(output.includes("Linux / macOS shell"));
    assert.ok(output.includes("Windows PowerShell"));
    assert.ok(output.includes("<details"));
    assert.ok(!/transition_|before|after/.test(output));
  }
  assert.ok(html.includes('data-platform="posix"'));
  assert.ok(html.includes('data-platform="powershell"'));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(markdown.includes("```bash\ncurl"));
  assert.equal((html.match(/<article /g) ?? []).length, 2);
  for (const before of [
    { posix: "only" },
    { posix: "x", powershell: "" },
    { posix: "x", powershell: "y", linux: "unknown" },
    [],
    null,
  ]) {
    assert.throws(
      () =>
        parseTree(
          JSON.stringify({
            ...tree,
            state: { ...tree.state, before },
          }),
        ),
      /state.before/,
    );
  }
});
test("documentation CLI never imports exploding binding or overwrites input; bad data fails visibly", async () => {
  const f = await fixture();
  try {
    const file = join(f.directory, "tree.yaml");
    const binding = join(f.directory, "binding.ts");
    await writeFile(file, source);
    await writeFile(binding, `throw new Error("MUST NOT IMPORT");`);
    const cli = resolve("src", "cli.ts");
    for (const format of ["tree", "markdown", "html"]) {
      const output = join(f.directory, `${format}.out`);
      const result = spawnSync(process.execPath, ["--import", "tsx", cli, file, format, output], {
        encoding: "utf8",
        cwd: resolve("..", ".."),
      });
      assert.equal(result.status, 0, result.stderr);
      assert.ok((await readFile(output, "utf8")).includes("Not run"));
    }
    const overwrite = spawnSync(process.execPath, ["--import", "tsx", cli, file, "html", binding], {
      encoding: "utf8",
    });
    assert.notEqual(overwrite.status, 0);
    assert.match(overwrite.stderr, /must not overwrite/);
    const exists = spawnSync(
      process.execPath,
      ["--import", "tsx", cli, file, "html", `${binding}.out`],
      { encoding: "utf8" },
    );
    assert.equal(exists.status, 0, exists.stderr);
    const repeat = spawnSync(
      process.execPath,
      ["--import", "tsx", cli, file, "html", `${binding}.out`],
      { encoding: "utf8" },
    );
    assert.notEqual(repeat.status, 0);
    await writeFile(file, source.replace("id: child", "id: root"));
    const invalid = spawnSync(process.execPath, ["--import", "tsx", cli, file, "tree"], {
      encoding: "utf8",
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /duplicate state root/);
  } finally {
    await f.close();
  }
});
test("Node adapter registers independent siblings and platform skips, not dependency blocking", async () => {
  const f = await fixture();
  try {
    const runner = pathToFileURL(resolve("src", "runner.ts")).href;
    const model = pathToFileURL(resolve("src", "model.ts")).href;
    const foreign = process.platform === "win32" ? "linux" : "win32";
    await writeFile(
      join(f.directory, "tree.yaml"),
      source.replace("id: child", `id: child\n      platforms: [${foreign}]`) +
        `
    - id: sibling
      title: Independent sibling
      before: enter sibling
      after: leave sibling
      checks:
        - id: pass
          title: Independent success
          doc: a fresh context
`,
    );
    await writeFile(
      join(f.directory, "binding.ts"),
      `
export function transition_root(c) { if(c.entered) throw Error("shared context"); c.entered=true; return ()=>{}; }
export function check_root_parent() { throw Error("deliberate probe failure"); }
export function transition_child() { throw Error("platform skip must not enter"); }
export function check_child_probe() { throw Error("must skip"); }
export function transition_sibling(c) { if(!c.entered) throw Error("missing ancestor"); return ()=>{}; }
export function check_sibling_pass() {}
`,
    );
    const entry = join(f.directory, "entry.ts");
    await writeFile(
      entry,
      `import {pathToFileURL} from "node:url"; import {loadTree} from ${JSON.stringify(model)}; import {registerTests} from ${JSON.stringify(runner)}; await registerTests(await loadTree(${JSON.stringify(join(f.directory, "tree.yaml"))}),()=>({}),(file)=>import(pathToFileURL(file).href));`,
    );
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--test", "--test-reporter=tap", entry],
      {
        encoding: "utf8",
        env: Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT"),
        ),
      },
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /not ok 1 - demo\/root.parent/);
    assert.match(result.stdout, /ok 2 - demo\/child.probe: Child probe # SKIP/);
    assert.match(result.stdout, /ok 3 - demo\/sibling.pass/);
    assert.match(result.stdout, /# pass 1/);
    assert.match(result.stdout, /# skipped 1/);
    const bindingFile = join(f.directory, "binding.ts");
    const binding = await readFile(bindingFile, "utf8");
    await writeFile(bindingFile, binding.replace("check_sibling_pass", "renamed_sibling_pass"));
    const invalid = spawnSync(
      process.execPath,
      ["--import", "tsx", "--test", "--test-reporter=tap", entry],
      {
        encoding: "utf8",
        env: Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT"),
        ),
      },
    );
    assert.equal(invalid.status, 1);
    assert.match(invalid.stdout, /check_sibling_pass/);
    assert.ok(!invalid.stdout.includes("deliberate probe failure"));
  } finally {
    await f.close();
  }
});
