import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createCheckResult } from "@potential-guide/check-sdk";
import { prepareCheck } from "@potential-guide/check-sdk/authoring";
import {
  type IpfsClient,
  readContentTree,
  validateContentCar,
} from "@potential-guide/ipfs-content";
import { MemoryIpfsClient } from "@potential-guide/ipfs-content/testing";
import { buildTask, readTaskArtifact, toTaskSchema } from "@potential-guide/task-authoring";
import { createTaskEngine, newId } from "@silvermoon-work/task-engine";
import { MemoryStore } from "@silvermoon-work/task-engine/testing";
import { createTaskHandler } from "@silvermoon-work/task-engine-http";
import {
  compileJsonSchema,
  readTaskBundle,
  TaskError,
  type TaskSnapshot,
} from "@silvermoon-work/task-protocol";
import type { TaskContext } from "@silvermoon-work/task-sdk";
import { parse, stringify } from "yaml";
import { type ProbeBuild, prepareProbe, verifyProbeResources } from "../src/authoring.js";
import { createProbeResultSchema } from "../src/contracts.js";
import { createCheckInvoker } from "../src/execution.js";
import { createProbeTask } from "../src/index.js";
import { createPinboardResolver } from "../src/publication.js";

const page = "---\ntitle: Page\ndescription: Description\n---\n[not-crawled](missing.md)\n";
async function put(root: string, path: string, value: string | Uint8Array) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), value);
}
async function fixture() {
  const directory = resolve(import.meta.dirname, "../.cache", `probe-${randomUUID()}`);
  const child = join(directory, "child");
  await put(
    child,
    "src/main.ts",
    `
import {createCheckTask} from "@potential-guide/check-sdk";
import {runTask} from "@silvermoon-work/task-sdk";
import {setTimeout as delay} from "node:timers/promises";
import {languages,problemCodes} from "../dist/definitions/text.js";
runTask(createCheckTask(problemCodes,languages,async(input,context)=>{
 if(input.text==="fault") throw new Error("child invocation fault");
 if(input.text==="slow") await delay(60000,undefined,{signal:context.signal});
 return input.text.trim()?[]:[{target:"text",code:"text-empty",actual:input.text}];
}));`,
  );
  await put(
    child,
    "src/contract.ts",
    `
import {Type} from "@sinclair/typebox";
import {createCheckContract} from "@potential-guide/check-sdk/contracts";
import {languages,problemCodes} from "../dist/definitions/text.js";
export default createCheckContract(Type.Object({text:Type.String()},{additionalProperties:false}),problemCodes,languages);`,
  );
  await put(child, "references/en/check.md", page);
  await put(child, "references/en/problems/text-empty.md", page);
  const binary = Buffer.alloc(270_000, 255);
  binary.set([13, 10, 0, 13]);
  await put(child, "assets/data.bin", binary);
  await put(
    child,
    "text.check.build.yaml",
    stringify({
      name: "Text",
      kind: "text",
      source: { root: "src", entry: "src/main.ts", contract: "src/contract.ts" },
      languages: ["en"],
      problemCodes: ["text-empty"],
      referenceRoot: "references",
      resources: [{ from: "assets/data.bin", to: "resources/assets/data.bin" }],
      binary: ["resources/assets/*.bin"],
    }),
  );
  const preparedChild = await prepareCheck(join(child, "text.check.build.yaml"));
  const builtChild = await buildTask(preparedChild.buildFile);
  const childArtifact = await readTaskArtifact(builtChild.car);
  const ipfs = new MemoryIpfsClient();
  await ipfs.import(childArtifact.files);
  const parent = join(directory, "parent");
  const config: ProbeBuild = {
    name: "Prepare text",
    kind: "text-ready",
    source: { root: "src", entry: "src/main.ts", contract: "src/contract.ts" },
    languages: ["en"],
    referenceRoot: "references",
    bundles: { text: { source: { kind: "ipfs", cid: builtChild.cid } } },
    checks: {
      first: { bundle: "text", inputMapping: "first" },
      peer: { bundle: "text", inputMapping: "second" },
      second: { bundle: "text", inputMapping: "third" },
    },
    levels: [
      { id: "empty", checks: [] },
      { id: "prepare-first", checks: ["first", "peer"] },
      { id: "prepare-second", checks: ["second"] },
    ],
  };
  await put(
    parent,
    "src/contract.ts",
    `
import {Type} from "@sinclair/typebox";
import {createProbeContract} from "@potential-guide/probe-sdk/contracts";
import {definitions} from "../dist/definitions/text-ready.js";
export default createProbeContract(Type.Object({
 first:Type.Object({text:Type.String()},{additionalProperties:false}),
 second:Type.Object({text:Type.String()},{additionalProperties:false}),
 third:Type.Object({text:Type.String()},{additionalProperties:false})
},{additionalProperties:false}),definitions);`,
  );
  await put(
    parent,
    "src/main.ts",
    `
import {runTask} from "@silvermoon-work/task-sdk";
import {createProbeTask} from "@potential-guide/probe-sdk";
import {definitions} from "../dist/definitions/text-ready.js";
runTask(createProbeTask(definitions,async()=>{throw new Error("transport not configured");}));`,
  );
  for (const suffix of [
    "objective",
    ...config.levels.map(({ id }) => `levels/${id}`),
    "levels/terminal",
    "checks/first/check",
    "checks/first/problems/text-empty",
  ])
    await put(parent, `references/en/${suffix}.md`, page);
  await put(parent, "text.probe.build.yaml", stringify(config));
  return {
    directory,
    parent,
    config,
    ipfs,
    builtChild,
    childArtifact,
    binary,
    file: join(parent, "text.probe.build.yaml"),
  };
}
const caller = { scope: "probe", subject: "fixture" };
async function settled(
  engine: ReturnType<typeof createTaskEngine>,
  taskId: string,
): Promise<TaskSnapshot> {
  for (let count = 0; count < 1000; count++) {
    const task = engine.getTask(taskId, caller);
    if (["completed", "failed", "stopped"].includes(task.stage)) return task;
    await delay(10);
  }
  throw new Error("Task did not settle.");
}

test("generic compiler preserves complete canonical child DAG, binary and snapshots", async () => {
  const f = await fixture();
  try {
    const prepared = await prepareProbe(f.file, { client: f.ipfs });
    await put(f.parent, "references/en/objective.md", "changed live source");
    const built = await buildTask(prepared.buildFile);
    const artifact = await readTaskArtifact(built.car);
    await verifyProbeResources(prepared, artifact);
    assert.deepEqual(
      readTaskBundle(artifact.files).declaration.include,
      [...artifact.files.keys()].sort(),
    );
    assert.deepEqual(readTaskBundle(artifact.files).declaration.binary, [
      "resources/checks/text/resources/assets/data.bin",
    ]);
    assert.deepEqual(
      artifact.files.get("resources/checks/text/resources/assets/data.bin"),
      f.binary,
    );
    const offline = new MemoryIpfsClient();
    for await (const _ of offline.dag.import([artifact.archive!], { pinRoots: false })) {
    }
    const tree = await readContentTree(offline, artifact.cid, {
      signal: new AbortController().signal,
    });
    assert.equal(tree.roots.get("resources/checks/text"), f.builtChild.cid);
    for (const [path, bytes] of f.childArtifact.files)
      assert.deepEqual(tree.files.get(`resources/checks/text/${path}`), Uint8Array.from(bytes));
    const rebuilt = await buildTask(prepared.buildFile);
    assert.equal(rebuilt.cid, built.cid);
    assert.deepEqual((await readTaskArtifact(built.directory)).files, artifact.files);
    const changed = new Map(artifact.files);
    changed.set("resources/checks/text/resources/assets/data.bin", Buffer.from("changed"));
    await assert.rejects(verifyProbeResources(prepared, { ...artifact, files: changed }), /differ/);
    await assert.rejects(validateContentCar(artifact.archive!.slice(0, -20)), Error);
    assert.equal(offline.pins.size, 0);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("publication API snapshot, precise locks and paired inferred author rules", async () => {
  const f = await fixture();
  try {
    let queries = 0;
    const resolver = createPinboardResolver({
      origin: "https://pinboard.shazhou.work",
      getPublication: async (id) => {
        queries++;
        return {
          id,
          currentRevision: 7,
          current: { revision: 7, cid: f.builtChild.cid, size: 123, blocks: 19 },
        };
      },
    });
    f.config.bundles.text!.source = {
      kind: "publication",
      url: "https://pinboard.shazhou.work/publications/test-check",
    };
    f.config.bundles.copy = structuredClone(f.config.bundles.text!);
    f.config.checks.peer!.bundle = "copy";
    await put(f.parent, "text.probe.build.yaml", stringify(f.config));
    const prepared = await prepareProbe(f.file, { client: f.ipfs, resolvePublication: resolver });
    assert.equal(queries, 1);
    assert.equal(prepared.lock.dependencies.text?.revision, 7);
    const locked = await prepareProbe(f.file, {
      client: f.ipfs,
      mode: "locked",
      lock: prepared.lock,
    });
    assert.equal(locked.staging, prepared.staging);
    assert.equal(queries, 1);
    await assert.rejects(prepareProbe(f.file, { client: f.ipfs, mode: "locked" }), /lock/);
    await assert.rejects(
      resolver("https://evil.test/publications/test-check", new AbortController().signal),
      /Unauthorized/,
    );
    const original = stringify(f.config);
    const cases: [string, (config: ProbeBuild) => void][] = [
      ["stale references", (config) => Object.assign(config, { references: {} })],
      ["include", (config) => Object.assign(config, { include: [] })],
      [
        "reserved stage",
        (config) => {
          config.levels[0]!.id = "initial";
        },
      ],
      [
        "unknown ref",
        (config) => {
          config.levels[0]!.checks = ["unknown"];
        },
      ],
      [
        "unused binding",
        (config) => {
          config.bundles.unused = config.bundles.text!;
        },
      ],
      [
        "mapping traversal",
        (config) => {
          config.checks.first!.inputMapping = "__proto__.x";
        },
      ],
      [
        "child binary",
        (config) => {
          config.binary = ["resources/checks/**"];
        },
      ],
      [
        "child collision",
        (config) => {
          config.resources = [
            { from: "references/en/objective.md", to: "resources/checks/text/worker.cjs" },
          ];
        },
      ],
      [
        "language fallback",
        (config) => {
          config.languages = ["en", "fr"];
        },
      ],
    ];
    for (const [name, change] of cases) {
      const config = parse(original) as ProbeBuild;
      change(config);
      await put(f.parent, "text.probe.build.yaml", stringify(config));
      await assert.rejects(
        prepareProbe(f.file, { client: f.ipfs, resolvePublication: resolver }),
        Error,
        name,
      );
    }
    await put(f.parent, "text.probe.build.yaml", original);
    for (const path of [
      "references/fr/objective.md",
      "references/en/checks/unknown/check.md",
      "references/en/checks/first/problems/unknown.md",
    ]) {
      await put(f.parent, path, page);
      await assert.rejects(
        prepareProbe(f.file, { client: f.ipfs, resolvePublication: resolver }),
        /Unknown/,
      );
      await rm(
        join(
          f.parent,
          path
            .split("/")
            .slice(0, path.includes("unknown/check") ? -1 : -1)
            .join("/"),
        ),
        { recursive: true, force: true },
      );
    }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("sparse overrides require complete same-language coverage and reject invalid pages", async () => {
  const f = await fixture();
  try {
    f.config.languages.push("zh-CN");
    await put(f.parent, "text.probe.build.yaml", stringify(f.config));
    for (const suffix of [
      "objective",
      ...f.config.levels.map(({ id }) => `levels/${id}`),
      "levels/terminal",
    ])
      await put(f.parent, `references/zh-CN/${suffix}.md`, page);
    await assert.rejects(prepareProbe(f.file, { client: f.ipfs }), /Missing effective zh-CN/);
    for (const ref of Object.keys(f.config.checks))
      for (const suffix of ["check", "problems/text-empty"])
        await put(f.parent, `references/zh-CN/checks/${ref}/${suffix}.md`, page);
    const prepared = await prepareProbe(f.file, { client: f.ipfs });
    assert.equal(
      prepared.objective.references["zh-CN"]?.checks.second?.check,
      "resources/references/zh-CN/checks/second/check.md",
    );
    await put(f.parent, "references/zh-CN/checks/first/check.md", "invalid discovered override");
    await assert.rejects(prepareProbe(f.file, { client: f.ipfs }), /frontmatter/);
    await put(f.parent, "references/zh-CN/checks/first/check.md", page);
    await rm(join(f.parent, "references/en/levels/terminal.md"));
    await assert.rejects(prepareProbe(f.file, { client: f.ipfs }), /Missing Reference/);
    const raw = await f.ipfs.block.put(Buffer.from("a CAR upload is not a Task directory"), {
      format: "raw",
    });
    f.config.bundles.text!.source = { kind: "ipfs", cid: raw.toString() };
    await put(f.parent, "text.probe.build.yaml", stringify(f.config));
    await assert.rejects(prepareProbe(f.file, { client: f.ipfs }), /directory of regular files/);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("Probe goals aggregate failures, scoped overrides, inheritance, terminal and invocation errors", async () => {
  const f = await fixture();
  try {
    const prepared = await prepareProbe(f.file, { client: f.ipfs });
    const schema = compileJsonSchema(toTaskSchema(createProbeResultSchema(prepared.definitions)));
    const fakeCid = f.builtChild.cid;
    const reads: string[] = [];
    const context = {
      signal: new AbortController().signal,
      bundle: {
        cid: fakeCid,
        read(path: string) {
          reads.push(path);
          const bytes = prepared.resources.get(path);
          if (!bytes) throw new Error("Missing resource.");
          return new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          });
        },
      },
    } as unknown as TaskContext;
    const task = createProbeTask(prepared.definitions, async (request) => {
      const { text } = request.input as { text: string };
      if (text === "fault") throw new Error("child failed");
      return createCheckResult(
        ["text-empty"],
        text ? [] : [{ target: "text", code: "text-empty", actual: text }],
        { cid: request.cid, languages: ["en"] },
      );
    });
    const failed = await task({ first: { text: "" }, second: { text: "" } }, context);
    schema.validate(failed);
    assert.equal(failed.currentLevel.id, "prepare-first");
    assert.deepEqual(
      failed.checks.map((check) => check.id),
      ["first", "peer"],
    );
    assert.match(failed.checks[0]!.documentation.en!, /checks\/first\/check.md$/);
    assert.match(failed.checks[1]!.documentation.en!, /references\/en\/check.md$/);
    assert.match(
      failed.checks[0]!.problems[0]!.documentation.en!,
      /checks\/first\/problems\/text-empty.md$/,
    );
    const later = await task(
      { first: { text: "ok" }, second: { text: "ok" }, third: { text: "" } },
      context,
    );
    schema.validate(later);
    assert.equal(later.currentLevel.id, "prepare-second");
    assert.deepEqual(
      later.checks.map((check) => check.id),
      ["second"],
    );
    const mixed = await task({ first: { text: "ok" }, second: { text: "" } }, context);
    assert.deepEqual(
      mixed.checks.map((check) => check.id),
      ["peer"],
    );
    const complete = await task(
      { first: { text: "ok" }, second: { text: "ok" }, third: { text: "ok" } },
      context,
    );
    schema.validate(complete);
    assert.equal(complete.currentLevel.id, "terminal");
    assert.deepEqual(complete.checks, []);
    assert.ok(reads.every((path) => path.endsWith(".json")));
    await assert.rejects(
      task({ first: { text: "fault" }, second: { text: "" } }, context),
      /child failed/,
    );
    await assert.rejects(task({}, context), /mapping not found/);
    for (const invalid of [42, { pass: true }, { pass: false, problems: "not-an-array" }])
      await assert.rejects(
        createProbeTask(prepared.definitions, async () => invalid)(
          { first: { text: "ok" } },
          context,
        ),
        /Invalid child Check result/,
      );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("metadata read cleanup preserves primary and cancellation errors and releases the reader", async () => {
  const cleanup = new Error("metadata cancellation failed");
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1_048_577));
    },
    cancel() {
      throw cleanup;
    },
  });
  const context = {
    signal: new AbortController().signal,
    bundle: { cid: "unused", read: () => stream },
  } as unknown as TaskContext;
  await assert.rejects(
    createProbeTask({ languages: ["en"], levels: [], problemCodes: {} }, async () => null)(
      {},
      context,
    ),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(String(error.cause), /metadata budget exceeded/);
      assert.equal(error.errors[0], error.cause);
      assert.equal(error.errors[1], cleanup);
      return true;
    },
  );
  assert.equal(stream.locked, false);
});

test("metadata cleanup failure after a successful read is reported rather than discarded", async () => {
  const cleanup = new Error("metadata cleanup failed");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from("{}"));
      controller.close();
    },
  });
  const reader = stream.getReader();
  reader.cancel = async () => {
    throw cleanup;
  };
  Object.defineProperty(stream, "getReader", { value: () => reader });
  const context = {
    signal: new AbortController().signal,
    bundle: { cid: "unused", read: () => stream },
  } as unknown as TaskContext;
  await assert.rejects(
    createProbeTask({ languages: ["en"], levels: [], problemCodes: {} }, async () => null)(
      {},
      context,
    ),
    (error) => error === cleanup,
  );
  assert.equal(stream.locked, false);
});

test("standard Engine executes Probe and independent child Tasks via authorized HTTP composition", {
  timeout: 90_000,
}, async () => {
  const f = await fixture();
  const store = new MemoryStore();
  const engine = createTaskEngine({
    store,
    ipfsClient: f.ipfs,
    authorize: (who) => who.scope === caller.scope,
  });
  await engine.start();
  const handler = createTaskHandler({
    service: engine,
    resolveCaller(request) {
      if (request.headers.get("authorization") !== "fixture-only-capability")
        throw new TaskError("forbidden", "Unauthorized.");
      return caller;
    },
  });
  const server = createServer(async (req, res) => {
    try {
      if (req.url?.startsWith("/ipfs/")) {
        const cid = req.url.slice(6).split("?")[0]!;
        res.writeHead(200, { "content-type": "application/vnd.ipld.raw" });
        res.end(await f.ipfs.block.get(cid));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await handler(
        new Request(`http://fixture${req.url}`, {
          method: req.method!,
          headers: Object.fromEntries(
            Object.entries(req.headers).map(([key, value]) => [key, String(value)]),
          ),
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await put(
      f.parent,
      "src/main.ts",
      `
import {runTask} from "@silvermoon-work/task-sdk";
import {createProbeTask} from "@potential-guide/probe-sdk";
import {createCheckInvoker} from "@potential-guide/probe-sdk/execution";
import {createIpfsGatewayClient} from "@potential-guide/ipfs-content";
import {TaskClient} from "@silvermoon-work/task-engine-http";
import {definitions} from "../dist/definitions/text-ready.js";
const service = new TaskClient({url:${JSON.stringify(url)},headers:{Authorization:"fixture-only-capability"},
 fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)})});
const invoke = createCheckInvoker({service,client:createIpfsGatewayClient(${JSON.stringify(url)}),
caller:{scope:"probe",subject:"fixture"},timeoutMs:10000,authorize:request=>request.cid===${JSON.stringify(f.builtChild.cid)}});
runTask(createProbeTask(definitions,invoke));`,
    );
    const prepared = await prepareProbe(f.file, { client: f.ipfs });
    const built = await buildTask(prepared.buildFile);
    const artifact = await readTaskArtifact(built.car);
    await verifyProbeResources(prepared, artifact);
    await f.ipfs.import(artifact.files);
    async function submit(text: string, second = "ok", timeoutMs = 20000) {
      const requestId = newId();
      await engine.submit(
        {
          requestId,
          bundle: built.cid,
          timeoutMs,
          first: { text },
          second: { text: second },
          third: { text: "ok" },
        },
        caller,
      );
      const status = await engine.getRequestStatus(requestId, { waitMs: 10000 }, caller);
      assert.equal(status.status, "accepted");
      if (status.status !== "accepted") throw new Error("Not admitted.");
      return status.taskId;
    }
    const fail = await settled(engine, await submit("", ""));
    assert.equal(fail.stage, "completed", JSON.stringify(fail));
    const result = fail.result as {
      objective: string;
      currentLevel: { id: string };
      checks: { id: string }[];
    };
    assert.equal(result.objective, built.cid);
    assert.equal(result.currentLevel.id, "prepare-first");
    assert.deepEqual(
      result.checks.map((check) => check.id),
      ["first", "peer"],
    );
    const good = await settled(engine, await submit("ok"));
    assert.equal(good.stage, "completed", JSON.stringify(good));
    assert.equal((good.result as { currentLevel: { id: string } }).currentLevel.id, "terminal");
    const fault = await settled(engine, await submit("fault"));
    assert.equal(fault.stage, "failed");
    assert.equal(fault.result, undefined);
    const slow = await submit("slow");
    for (let count = 0; count < 500; count++) {
      if (
        Object.values(store.read().facts.tasks).some(
          (task) =>
            task.binding.version === f.builtChild.cid &&
            task.input &&
            (task.input as { text: string }).text === "slow",
        )
      )
        break;
      await delay(10);
    }
    engine.cancelTask(slow, caller);
    await settled(engine, slow);
    await delay(100);
    const children = Object.values(store.read().facts.tasks).filter(
      (task) => task.binding.version === f.builtChild.cid,
    );
    assert.ok(children.length >= 6);
    assert.ok(children.some((task) => task.canceledAt));
    assert.ok(children.every((task) => task.binding.bundle === f.builtChild.cid));
    const deadlineTask = await submit("slow", "ok", 1000);
    const expired = await settled(engine, deadlineTask);
    assert.equal(expired.result, undefined);
    await delay(100);
    const deadlineChildren = Object.values(store.read().facts.tasks).filter(
      (task) => task.binding.version === f.builtChild.cid && task.canceledAt,
    );
    assert.ok(deadlineChildren.length >= 2, "parent deadline must cancel the child Task");
    const bounded = createCheckInvoker({
      service: engine,
      client: f.ipfs,
      caller,
      timeoutMs: 100,
      authorize: () => true,
    });
    const context = {
      scope: caller.scope,
      signal: new AbortController().signal,
      bundle: { cid: built.cid },
    } as TaskContext;
    await assert.rejects(
      bounded(
        {
          parentCid: built.cid,
          path: "resources/checks/text",
          cid: f.builtChild.cid,
          input: { text: "slow" },
        },
        context,
      ),
    );
    await assert.rejects(
      bounded(
        {
          parentCid: built.cid,
          path: "resources/checks/text",
          cid: built.cid,
          input: { text: "ok" },
        },
        context,
      ),
      /does not match/,
    );
    await assert.rejects(
      bounded(
        {
          parentCid: built.cid,
          path: "resources/checks/text",
          cid: f.builtChild.cid,
          input: { text: 42 },
        },
        context,
      ),
    );
    const denied = createCheckInvoker({
      service: engine,
      client: f.ipfs as IpfsClient,
      caller,
      timeoutMs: 1000,
      authorize: () => false,
    });
    await assert.rejects(
      denied(
        {
          parentCid: built.cid,
          path: "resources/checks/text",
          cid: f.builtChild.cid,
          input: { text: "ok" },
        },
        {
          scope: caller.scope,
          signal: new AbortController().signal,
        } as TaskContext,
      ),
      /not authorized/,
    );
  } finally {
    await engine.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(f.directory, { recursive: true, force: true });
  }
});
