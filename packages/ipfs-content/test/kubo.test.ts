import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { collectBytes } from "../src/blocks.js";
import {
  createIpfsClient,
  createIpfsGatewayClient,
  encodeContentCar,
  openContent,
  pinContent,
  writeContentCar,
} from "../src/index.js";

test("isolated offline Kubo imports exact CAR blocks without implicit pinning, then pins explicitly and serves Gateway reads", {
  skip: !process.env.PGUIDE_KUBO_BINARY,
  timeout: 60_000,
}, async () => {
  const binary = resolve(process.env.PGUIDE_KUBO_BINARY!);
  const root = resolve(".cache", `kubo-car-${crypto.randomUUID()}`);
  const repo = join(root, "repo");
  await mkdir(root, { recursive: true });
  const env = { ...process.env, IPFS_PATH: repo };
  const execute = promisify(execFile);
  let daemon: ReturnType<typeof spawn> | undefined;
  let log = "";
  try {
    await execute(binary, ["init", "--profile=test"], { env });
    await execute(binary, ["config", "Addresses.API", "/ip4/127.0.0.1/tcp/0"], { env });
    await execute(binary, ["config", "Addresses.Gateway", "/ip4/127.0.0.1/tcp/0"], { env });
    daemon = spawn(binary, ["daemon", "--offline", "--migrate=false"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    daemon.stdout?.on("data", (chunk) => {
      log += String(chunk);
    });
    daemon.stderr?.on("data", (chunk) => {
      log += String(chunk);
    });
    const deadline = Date.now() + 30_000;
    while (!log.includes("Daemon is ready")) {
      if (Date.now() > deadline || daemon.exitCode !== null)
        throw new Error(`Isolated Kubo did not start: ${log}`);
      await delay(50);
    }
    const api = /^\/ip4\/127\.0\.0\.1\/tcp\/(\d+)$/.exec(
      (await readFile(join(repo, "api"), "utf8")).trim(),
    );
    const gateway = /Gateway server listening on \/ip4\/127\.0\.0\.1\/tcp\/(\d+)/.exec(log);
    assert.ok(api && gateway, log);
    const rpc = await createIpfsClient(`http://127.0.0.1:${api[1]}`);
    const bytes = Buffer.alloc(700_000, 42);
    const encoded = await encodeContentCar(
      new Map([
        ["nested/large.bin", bytes],
        ["empty.txt", Buffer.alloc(0)],
      ]),
    );
    await writeContentCar(encoded.bytes, encoded.cid, rpc);
    await assert.rejects(async () => {
      for await (const _pin of rpc.pin.ls({ paths: [encoded.cid] })) {
        assert.fail("CAR import must not implicitly pin roots.");
      }
    }, /not pinned/i);
    await pinContent(encoded.cid, rpc);
    const pins = [];
    for await (const pin of rpc.pin.ls({ paths: [encoded.cid] })) pins.push(pin.cid.toString());
    assert.deepEqual(pins, [encoded.cid]);
    const client = createIpfsGatewayClient(`http://127.0.0.1:${gateway[1]}`);
    const entry = await openContent(client, `${encoded.cid}/nested/large.bin`, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(entry.type, "file");
    if (entry.type !== "file") throw new Error("Expected UnixFS file.");
    assert.deepEqual(Buffer.from(await collectBytes(entry.content(), bytes.length)), bytes);
    if (process.env.PGUIDE_KUBO_E2E === "1") {
      const workspace = resolve(import.meta.dirname, "..", "..", "..");
      const result = await execute(
        process.execPath,
        [join(workspace, "scripts", "verify-task-ipfs.mjs")],
        {
          cwd: workspace,
          env: {
            ...env,
            IPFS_API: `http://127.0.0.1:${api[1]}`,
            IPFS_GATEWAY: `http://127.0.0.1:${gateway[1]}`,
          },
          timeout: 45_000,
        },
      );
      const proof = JSON.parse(result.stdout);
      assert.equal(proof.publicationViaCar, true);
      assert.equal(proof.sourceIndependentWorker, true);
      assert.equal(proof.nodeAndCallerPinSurviveEngineClose, true);
    }
  } finally {
    if (daemon && daemon.exitCode === null) {
      const exited = once(daemon, "exit");
      daemon.kill();
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
