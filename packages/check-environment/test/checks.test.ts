import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import test from "node:test";
import { executeCommand } from "../src/command.js";
import {
  checkDirectories as runDirectories,
  checkNetwork as runNetwork,
  checkTools as runTools,
  compareVersions,
  parseToolVersion,
  probeDirectoryWrite,
} from "../src/index.js";
import type { CheckContext, DirectoryInput, NetworkInput, ToolInput } from "../src/index.js";

const bundle = { cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gyz5l2v4vtwqgxx5lhh3mfxe" };
const checkTools = (input: ToolInput, context: CheckContext = {}) =>
  runTools(input, { ...context, bundle });
const checkDirectories = (input: DirectoryInput, context: CheckContext = {}) =>
  runDirectories(input, { ...context, bundle });
const checkNetwork = (input: NetworkInput, context: CheckContext = {}) =>
  runNetwork(input, { ...context, bundle });

async function workspace(run: (directory: string) => Promise<void>) {
  await mkdir(resolve(".cache"), { recursive: true });
  const directory = await mkdtemp(join(resolve(".cache"), "check-environment-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("tools report measured numeric versions, missing tools, invalid output and minimum gaps", async () => {
  assert.equal(parseToolVersion("node v22.13.0\n"), "22.13.0");
  assert.equal(compareVersions("22.13", "22.13.0"), 0);
  assert.equal(compareVersions("100000000000000000001", "100000000000000000000"), 1);
  assert.throws(() => compareVersions("v22", "22"), /Versions/);
  const output = await checkTools({
    tools: [
      {
        command: process.execPath,
        args: ["-e", "console.log('v22.13.0')"],
        minimumVersion: "22.13",
      },
      {
        command: process.execPath,
        args: ["-e", "console.log('v20.0.0')"],
        minimumVersion: "22.13",
      },
      {
        command: process.execPath,
        args: ["-e", "console.log('unknown')"],
        minimumVersion: "22.13",
      },
      { command: `missing-check-${randomUUID()}`, args: ["--version"], minimumVersion: "1.0" },
      { command: process.execPath, args: ["-e", "process.exit(2)"], minimumVersion: "1.0" },
    ],
  });
  assert.equal(output.pass, false);
  if (output.pass) throw new Error("Expected tool problems.");
  assert.deepEqual(
    output.problems.map(({ code }) => code),
    ["tool-version", "version-unparseable", "tool-missing", "tool-unusable"],
  );
  assert.equal(output.problems[0]?.actual, "20.0.0");
  await assert.rejects(checkTools({ tools: [] }), /Specify/);
  await assert.rejects(checkTools({ tools: [], checkTimeoutMs: 0 }), /Specify/);
});

test("directory checks do not create business paths or alter files, and clean their write probes", async () => {
  await workspace(async (directory) => {
    const preserved = join(directory, "keep.txt");
    await writeFile(preserved, "keep");
    const file = join(directory, "file");
    await writeFile(file, "");
    const link = join(directory, "link");
    await symlink(directory, link, process.platform === "win32" ? "junction" : "dir");
    const before = await readdir(directory);
    const output = await checkDirectories({
      directories: [
        { path: directory, requirements: ["exists", "read", "write"] },
        { path: join(directory, "missing"), requirements: ["exists", "write"] },
        { path: file, requirements: ["exists"] },
        { path: link, requirements: ["exists"] },
      ],
    });
    assert.equal(output.pass, false);
    if (output.pass) throw new Error("Expected directory problems.");
    assert.deepEqual(
      output.problems.map(({ code }) => code),
      ["directory-unusable", "not-directory", "not-directory"],
    );
    assert.deepEqual(await readdir(directory), before);
    assert.equal(await readFile(preserved, "utf8"), "keep");
    await assert.rejects(
      checkDirectories({ directories: [{ path: ".", requirements: ["read"] }] }),
      /absolute/,
    );
    await assert.rejects(checkDirectories({ directories: [] }), /Specify/);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await assert.rejects(probeDirectoryWrite(directory, controller.signal), /cancelled/);
    assert.deepEqual(await readdir(directory), before);
    await mkdir(join(directory, "nested"));
  });
});

test("network checks cover DNS, HTTP status, redirects, timeout and cancellation without public endpoints", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/hang") return;
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/ok" });
      response.end();
      return;
    }
    response.writeHead(request.url === "/bad" ? 503 : 200);
    response.end("healthy");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const endpoint = (path: string, followRedirects = false) => ({
    url: base + path,
    expectedStatus: [200],
    followRedirects,
  });
  try {
    const output = await checkNetwork({
      dns: ["localhost"],
      http: [endpoint("/ok"), endpoint("/bad"), endpoint("/redirect"), endpoint("/redirect", true)],
    });
    assert.equal(output.pass, false);
    if (output.pass) throw new Error("Expected HTTP problems.");
    assert.deepEqual(
      output.problems.map(({ documentation: _, ...problem }) => problem),
      [
        { target: `${base}/bad`, code: "http-status", actual: "503" },
        { target: `${base}/redirect`, code: "http-status", actual: "302" },
      ],
    );
    await assert.rejects(
      checkNetwork({ dns: [], http: [endpoint("/hang")], checkTimeoutMs: 100 }),
      /timed out/,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("cancelled")), 50);
    try {
      await assert.rejects(
        checkNetwork({ dns: [], http: [endpoint("/hang")] }, { signal: controller.signal }),
        /cancelled/,
      );
    } finally {
      clearTimeout(timer);
    }
    await assert.rejects(checkNetwork({ dns: [], http: [] }), /Specify/);
    await assert.rejects(
      checkNetwork({ dns: [], http: [{ ...endpoint("/ok"), url: "file:///private" }] }),
      /HTTP/,
    );
    await assert.rejects(
      checkNetwork({
        dns: [],
        http: [{ ...endpoint("/ok"), url: "http://user:password@localhost/" }],
      }),
      /credentials/,
    );
    await assert.rejects(checkNetwork({ dns: ["bad name"], http: [] }), /DNS/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  const unavailable = await checkNetwork({ dns: [], http: [endpoint("/ok")] });
  assert.equal(unavailable.pass, false);
  if (unavailable.pass) throw new Error("Expected an unavailable endpoint.");
  assert.equal(unavailable.problems[0]?.code, "http-unavailable");
});

test("command faults explicitly reject timeout, output overflow and cancellation", async () => {
  await assert.rejects(
    executeCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], 100),
    /timed out|cleanup/,
  );
  await assert.rejects(
    executeCommand(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(300000));setInterval(()=>{},1000)"],
      5000,
    ),
    /output|cleanup/,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("cancelled")), 100);
  try {
    await assert.rejects(
      executeCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], 5000, controller.signal),
      /cancelled|cleanup/,
    );
  } finally {
    clearTimeout(timer);
  }
});

test("command cancellation confirms the started process is no longer alive", async () => {
  await workspace(async (directory) => {
    const marker = join(directory, "pid.txt");
    const source = `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`;
    const controller = new AbortController();
    const execution = executeCommand(process.execPath, ["-e", source], 10000, controller.signal);
    const rejected = assert.rejects(execution, /Command cancelled/);
    let pid: number | undefined;
    const deadline = Date.now() + 5000;
    try {
      while (pid === undefined) {
        try {
          pid = Number(await readFile(marker, "utf8"));
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT")
            throw error;
          if (Date.now() > deadline) throw new Error("Command did not start.");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
    } finally {
      controller.abort(new Error("cancelled"));
    }
    await rejected;
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  });
});
