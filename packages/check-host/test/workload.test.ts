import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { CheckKernel, type CheckState, readArtifact, terminal } from "../dist/index.js";

const source = `
const {createHash}=require("node:crypto");
let cache,initializations=0,calls=0;
exports.initialize=()=>{initializations++;cache=Buffer.alloc(65536,7)};
exports.execute=async(subject,context)=>{
  calls++;
  if(subject.wait)await new Promise(done=>{
    const timer=setTimeout(done,5000);
    const abort=()=>{clearTimeout(timer);done()};
    context.signal.addEventListener("abort",abort,{once:true});
    context.defer(()=>{clearTimeout(timer);context.signal.removeEventListener("abort",abort)});
    if(context.signal.aborted)abort();
  });
  if(subject.fault)throw Error("intentional workload fault");
  return {ok:!subject.businessFail,checksum:createHash("sha256").update(cache).update(subject.text).digest("hex"),initializations,calls};
};
exports.dispose=()=>{cache=undefined};
`;
const baselineDriver = `
const module_=require(process.argv[2]);
(async()=>{
  let text="";for await(const chunk of process.stdin)text+=chunk;
  await module_.initialize?.();
  const result=await module_.execute(JSON.parse(text),{
    signal:new AbortController().signal,defer:()=>{},data:{resolutions:[]},deadline:Date.now()+10000,progress:()=>{}
  });
  await module_.dispose?.();
  process.stdout.write(JSON.stringify({result,memory:process.memoryUsage()}));
})().catch(error=>{console.error(error);process.exitCode=1});
`;
async function finished(kernel: CheckKernel, id: string): Promise<CheckState> {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    const state = kernel.sample(id);
    if (terminal(state)) return state;
    await new Promise((done) => setTimeout(done, 1));
  }
  throw new Error(`Workload deadline exceeded: ${id}`);
}
async function processBaseline(driver: string, entry: string, subject: unknown) {
  const started = performance.now();
  const child = spawn(process.execPath, [driver, entry], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  let error = "";
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    error += chunk;
  });
  try {
    const code = await new Promise((done, reject) => {
      child.once("error", reject);
      child.once("close", done);
      child.stdin.end(JSON.stringify(subject));
    });
    assert.equal(code, 0, error);
    return { ms: performance.now() - started, ...JSON.parse(output) };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const round = (value: number) => Math.round(value * 100) / 100;

test("same-input process baselines, 96 bounded mixed executions and real package checker cold/hot", async (t) => {
  const parent = resolve(".cache", "check-host-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "workload-"));
  const directory = join(root, "artifact");
  await mkdir(directory);
  await writeFile(join(directory, "worker.cjs"), source);
  const driver = join(root, "baseline.cjs");
  await writeFile(driver, baselineDriver);
  const kernel = await CheckKernel.create(join(root, "snapshots"), {
    workers: 2,
    retireAfter: 8,
    records: 128,
    retentionMs: 60_000,
    deadlineMs: 10_000,
    cleanupMs: 2000,
  });

  const measureRealChecker = async () => {
    const parent = resolve(".cache", "check-host-tests");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(join(parent, "real-checker-"));
    const target = join(root, "target");
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "independent-target", private: true }),
      "README.md": "# Independent",
      "pnpm-workspace.yaml": "packages: [packages/*]",
      "turbo.json": JSON.stringify({
        tasks: { build: { outputs: ["dist/**"], dependsOn: ["^build"] }, check: { outputs: [] } },
      }),
      "packages/shared/package.json": JSON.stringify({
        name: "shared",
        private: true,
        scripts: { build: "MUST_NOT_EXECUTE", check: "MUST_NOT_EXECUTE" },
      }),
      "packages/shared/README.md": "# Shared",
      "packages/shared/src/index.ts": "export const value = 1;",
    };
    for (const [name, text] of Object.entries(files)) {
      const path = join(target, ...name.split("/"));
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, text);
    }
    const directory = resolve(
      import.meta.dirname,
      "..",
      "..",
      "objective-package-standard",
      "dist",
      "package",
      "checks",
      "structure",
    );
    const driver = join(root, "baseline.cjs");
    await writeFile(driver, baselineDriver);
    const kernel = await CheckKernel.create(join(root, "snapshots"), { workers: 1 });
    const subject = {
      root: target,
      directory: "packages/shared",
      roles: ["internal"],
      runtime: "universal",
      allows: [],
      entries: ["src/index.ts"],
      generated: [],
      joins: [],
      deliveries: [],
    };
    try {
      const artifact = await readArtifact(directory);
      const baseline: Awaited<ReturnType<typeof processBaseline>>[] = [];
      for (let n = 0; n < 12; n++)
        baseline.push(await processBaseline(driver, join(directory, "worker.cjs"), subject));
      assert.equal(baseline[0]?.result.status, 200);
      assert.equal(baseline[0]?.result.payload.ok, true, baseline[0]?.result.message);
      const times: number[] = [];
      for (let n = 0; n < 12; n++) {
        const started = performance.now();
        await kernel.executeCheck({
          checkId: `real-${n}`,
          directory,
          revision: artifact.revision,
          subject,
        });
        const result = await finished(kernel, `real-${n}`);
        times.push(performance.now() - started);
        assert.equal(result.state, "Completed");
        if (result.state === "Completed") assert.deepEqual(result.result, baseline[n]?.result);
      }
      assert.equal(kernel.diagnostics().initializations, 1);
      t.diagnostic(
        JSON.stringify({
          workload: "package-standard/structure",
          node: process.version,
          processSamplesMs: baseline.map(({ ms }) => round(ms)),
          processMedianMs: round(median(baseline.map(({ ms }) => ms))),
          processTotalMs: round(baseline.reduce((sum, { ms }) => sum + ms, 0)),
          workerColdMs: round(times[0] ?? 0),
          workerHotSamplesMs: times.slice(1).map(round),
          workerHotMedianMs: round(median(times.slice(1))),
          workerTotalMs: round(times.reduce((sum, ms) => sum + ms, 0)),
          diagnostics: kernel.diagnostics(),
          processRssMiB: baseline.map(({ memory }) => round(memory.rss / 1048576)),
          hostRssMiB: round(process.memoryUsage().rss / 1048576),
        }),
      );
    } finally {
      await kernel.close();
      await rm(root, { recursive: true, force: true });
    }
  };
  try {
    const artifact = await readArtifact(directory);
    const subject = { text: "same-input-".repeat(6000) };
    const baseline: Awaited<ReturnType<typeof processBaseline>>[] = [];
    for (let n = 0; n < 7; n++)
      baseline.push(await processBaseline(driver, join(directory, "worker.cjs"), subject));
    const coldHot: number[] = [];
    for (let n = 0; n < 7; n++) {
      const started = performance.now();
      await kernel.executeCheck({
        checkId: `timed-${n}`,
        directory,
        revision: artifact.revision,
        subject,
      });
      const result = await finished(kernel, `timed-${n}`);
      coldHot.push(performance.now() - started);
      assert.equal(result.state, "Completed");
      if (result.state === "Completed") {
        assert.equal(
          (result.result as { checksum: string }).checksum,
          baseline[n]?.result.checksum,
        );
        assert.equal((result.result as { initializations: number }).initializations, 1);
      }
    }
    const timingDiagnostics = kernel.diagnostics();
    const memory: NodeJS.MemoryUsage[] = [process.memoryUsage()];
    const counts = { Completed: 0, Failed: 0, Cancelled: 0 };
    for (let n = 0; n < 96; n++) {
      const cancel = n % 8 === 0;
      const id = `mixed-${n}`;
      await kernel.executeCheck({
        checkId: id,
        directory,
        revision: artifact.revision,
        subject: {
          ...subject,
          wait: cancel,
          fault: !cancel && n % 11 === 0,
          businessFail: n % 3 === 0,
        },
      });
      if (cancel) {
        const deadline = Date.now() + 5000;
        while (kernel.sample(id).state === "Queued") {
          assert.ok(Date.now() < deadline);
          await new Promise((done) => setTimeout(done, 1));
        }
        kernel.cancel(id);
      }
      const result = await finished(kernel, id);
      assert.ok(
        result.state === "Completed" || result.state === "Failed" || result.state === "Cancelled",
      );
      counts[result.state]++;
      const stats = kernel.diagnostics();
      assert.ok(stats.workers <= 2 && stats.records <= 128 && stats.queue <= 64);
      assert.equal(stats.ownedProcesses, 0);
      if (n % 16 === 15) memory.push(process.memoryUsage());
    }
    const stats = kernel.diagnostics();
    assert.equal(counts.Cancelled, 12);
    assert.ok(counts.Failed > 0 && counts.Completed > 0);
    assert.ok(stats.retirements >= 8 && stats.peakWorkers <= 2);
    assert.ok(stats.initializations < stats.executions / 2);
    assert.ok(kernel.workerSamples.length <= 64);
    assert.ok(
      kernel.workerSamples.every(
        ({ resources }) => resources.timers === 0 && resources.processes === 0,
      ),
    );
    t.diagnostic(
      JSON.stringify({
        node: process.version,
        platform: process.platform,
        inputBytes: Buffer.byteLength(JSON.stringify(subject)),
        processSamplesMs: baseline.map(({ ms }) => round(ms)),
        processMedianMs: round(median(baseline.map(({ ms }) => ms))),
        workerColdMs: round(coldHot[0] ?? 0),
        workerHotSamplesMs: coldHot.slice(1).map(round),
        workerHotMedianMs: round(median(coldHot.slice(1))),
        baselineInitializations: baseline.length,
        pooledInitializationsAfterTiming: timingDiagnostics.initializations,
        mixedOutcomes: counts,
        diagnostics: stats,
        processRssMiB: baseline.map(({ memory }) => round(memory.rss / 1048576)),
        hostRssMiB: memory.map(({ rss }) => round(rss / 1048576)),
        hostHeapMiB: memory.map(({ heapUsed }) => round(heapUsed / 1048576)),
        rssRangeMiB: round(
          (Math.max(...memory.map(({ rss }) => rss)) - Math.min(...memory.map(({ rss }) => rss))) /
            1048576,
        ),
      }),
    );
  } finally {
    await kernel.close();
    await rm(root, { recursive: true, force: true });
  }
  await measureRealChecker();
});

test("512 mixed executions cross retention windows without retaining unbounded request resources", async (t) => {
  const parent = resolve(".cache", "check-host-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "retention-workload-"));
  const directory = join(root, "artifact");
  await mkdir(directory);
  await writeFile(join(directory, "worker.cjs"), source);
  const kernel = await CheckKernel.create(join(root, "snapshots"), {
    workers: 2,
    retireAfter: 32,
    records: 64,
    retentionMs: 100,
    deadlineMs: 10_000,
    cleanupMs: 2000,
  });
  const memory: NodeJS.MemoryUsage[] = [];
  const counts = { Completed: 0, Failed: 0, Cancelled: 0 };
  let peakRecords = 0;
  try {
    const artifact = await readArtifact(directory);
    for (let batch = 0; batch < 32; batch++) {
      for (let n = 0; n < 16; n++) {
        const id = `retention-${batch}-${n}`;
        await kernel.executeCheck({
          checkId: id,
          directory,
          revision: artifact.revision,
          subject: {
            text: `${batch}-${n}-${"x".repeat(65536)}`,
            wait: n === 0,
            fault: n === 1,
            businessFail: n % 3 === 0,
          },
        });
        if (n === 0) {
          const end = Date.now() + 5000;
          while (kernel.sample(id).state === "Queued") {
            assert.ok(Date.now() < end);
            await new Promise((done) => setTimeout(done, 1));
          }
          kernel.cancel(id);
        }
        const state = await finished(kernel, id);
        assert.ok(
          state.state === "Completed" || state.state === "Failed" || state.state === "Cancelled",
        );
        counts[state.state]++;
        const stats = kernel.diagnostics();
        peakRecords = Math.max(peakRecords, stats.records);
        assert.ok(stats.records <= 64 && stats.workers <= 2);
        assert.equal(stats.ownedProcesses, 0);
      }
      await new Promise((done) => setTimeout(done, 210));
      assert.throws(() => kernel.sample(`retention-${batch}-0`), { status: 404 });
      assert.equal(kernel.diagnostics().records, 0);
      memory.push(process.memoryUsage());
    }
    const stats = kernel.diagnostics();
    assert.deepEqual(counts, { Completed: 448, Failed: 32, Cancelled: 32 });
    assert.equal(stats.executions, 512);
    assert.ok(stats.initializations < 64 && stats.retirements >= 14);
    assert.ok(kernel.workerSamples.length <= 64);
    assert.ok(
      kernel.workerSamples.every(
        ({ resources }) => resources.timers === 0 && resources.processes === 0,
      ),
    );
    t.diagnostic(
      JSON.stringify({
        workload: "512-retention-windows",
        node: process.version,
        platform: process.platform,
        mixedOutcomes: counts,
        diagnostics: stats,
        peakRecords,
        hostRssMiB: memory.map(({ rss }) => round(rss / 1048576)),
        hostHeapMiB: memory.map(({ heapUsed }) => round(heapUsed / 1048576)),
      }),
    );
  } finally {
    await kernel.close();
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(kernel.diagnostics().workers, 0);
  assert.equal(kernel.diagnostics().records, 0);
});
