import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  CheckClient,
  CheckKernel,
  type CheckState,
  createPrivateDirectory,
  createPrivateFile,
  type HostAddress,
  HostError,
  readArtifact,
  serve,
  terminal,
} from "@potential-guide/check-host";

export const scratch = resolve(import.meta.dirname, "..", "..", "..", "..", ".cache", "tree-host");
export const marker = "test-tree-owned-v1";
export class Context {
  directory!: string;
  client!: CheckClient;
  hostActive = false;
}
export async function releaseAll(actions: (() => Promise<void>)[]): Promise<void> {
  const errors: unknown[] = [];
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Scenario cleanup failed");
}
export async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
export async function until<T>(read: () => Promise<T>, matches: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (matches(value)) return value;
    assert.ok(Date.now() < deadline, "Scenario readiness timed out");
    await new Promise((done) => setTimeout(done, 20));
  }
}
export async function prepare(): Promise<string> {
  await mkdir(scratch, { recursive: true });
  const directory = await createPrivateDirectory(scratch, "case-");
  try {
    await writeFile(join(directory, "owner"), marker, { flag: "wx" });
    await mkdir(join(directory, "artifact"));
    await mkdir(join(directory, "controls"));
    await copyFile(
      join(import.meta.dirname, "worker.cjs"),
      join(directory, "artifact", "worker.cjs"),
    );
    return directory;
  } catch (error) {
    await releaseAll([() => rm(directory, { recursive: true, force: true })]).catch((cleanup) => {
      throw new AggregateError([error, cleanup], "Partial fixture initialization failed");
    });
    throw error;
  }
}
export async function owned(directory: string): Promise<void> {
  assert.equal(
    dirname(resolve(directory)),
    scratch,
    "Use only an explicitly prepared scenario directory",
  );
  assert.equal(await readFile(join(directory, "owner"), "utf8"), marker);
}
export async function startHost(directory: string) {
  await owned(directory);
  const token = randomUUID();
  const kernel = await CheckKernel.create(join(directory, "snapshots"), {
    deadlineMs: 120_000,
    cleanupMs: 30_000,
  });
  let host: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    host = await serve(kernel, token);
    const address: HostAddress = {
      endpoint: host.endpoint,
      token,
      pid: process.pid,
      instance: randomUUID(),
    };
    const client = new CheckClient(address);
    await active(client);
    await createPrivateFile(directory, "manual-host.json", `${JSON.stringify(address)}\n`);
    const ownedHost = host;
    return { client, close: () => releaseAll([() => ownedHost.close(), () => kernel.close()]) };
  } catch (error) {
    const acquiredHost = host;
    try {
      await releaseAll([
        ...(acquiredHost ? [() => acquiredHost.close()] : []),
        () => kernel.close(),
      ]);
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "Partial Host initialization failed");
    }
    throw error;
  }
}
export async function active(client: CheckClient): Promise<unknown[]> {
  const response = await fetch(`${client.address.endpoint}/checks`, {
    headers: { authorization: `Bearer ${client.address.token}` },
    signal: AbortSignal.timeout(2000),
  });
  assert.equal(response.status, 200);
  return response.json() as Promise<unknown[]>;
}
export async function submit(
  context: Context,
  id: string,
  subject: { hold?: boolean; fail?: boolean },
) {
  const directory = join(context.directory, "artifact");
  await context.client.start({
    checkId: id,
    directory,
    revision: (await readArtifact(directory)).revision,
    subject: { ...subject, marker: "tree-manual", controls: join(context.directory, "controls") },
  });
}
export async function running(context: Context) {
  await submit(context, "held", { hold: true });
  await until(
    () => context.client.sample("held"),
    (s) => s.state === "Running" && !!s.progress,
  );
}
export async function cancel(context: Context) {
  await context.client.cancel("held");
  await until(
    () => context.client.sample("held"),
    (s) => s.state === "Cancelling",
  );
  await until(() => exists(join(context.directory, "controls", "cleaning")), Boolean);
}
export async function release(context: Context) {
  await writeFile(join(context.directory, "controls", "release"), "released");
}
export async function cancelled(context: Context) {
  await release(context);
  const result = await context.client.wait("held", AbortSignal.timeout(10_000));
  assert.equal(result.state, "Cancelled");
}
export async function finishHeld(context: Context) {
  await release(context);
  let state: CheckState;
  try {
    state = await context.client.sample("held");
  } catch (error) {
    if (error instanceof HostError && error.status === 404) return;
    throw error;
  }
  if (!terminal(state)) await context.client.cancel("held");
  await context.client.wait("held", AbortSignal.timeout(10_000));
}
export async function fault(context: Context) {
  await submit(context, "fault", { fail: true });
  assert.equal((await context.client.wait("fault", AbortSignal.timeout(10_000))).state, "Failed");
}
export async function recover(context: Context) {
  await submit(context, "recovery", {});
  assert.equal(
    (await context.client.wait("recovery", AbortSignal.timeout(10_000))).state,
    "Completed",
  );
}
export async function inspect(context: Context, name: string) {
  let state: CheckState;
  switch (name) {
    case "idle":
      assert.deepEqual(await active(context.client), []);
      break;
    case "running":
      state = await context.client.sample("held");
      assert.equal(state.state, "Running");
      if (state.state === "Running")
        assert.deepEqual(state.progress, { entered: true, marker: "tree-manual", calls: 1 });
      assert.equal((await active(context.client)).length, 1);
      break;
    case "cancelling":
      assert.equal((await context.client.sample("held")).state, "Cancelling");
      assert.equal(await exists(join(context.directory, "controls", "cleaning")), true);
      assert.equal(await exists(join(context.directory, "controls", "cleaned")), false);
      break;
    case "cancelled":
      assert.equal((await context.client.sample("held")).state, "Cancelled");
      assert.equal(await exists(join(context.directory, "controls", "cleaned")), true);
      assert.deepEqual(await active(context.client), []);
      break;
    case "faulted":
      state = await context.client.sample("fault");
      assert.equal(state.state, "Failed");
      if (state.state === "Failed") assert.match(state.error, /manual injected failure/);
      assert.deepEqual(await active(context.client), []);
      break;
    case "recovered":
      state = await context.client.sample("recovery");
      assert.equal(state.state, "Completed");
      if (state.state === "Completed")
        assert.deepEqual(state.result, { marker: "tree-manual", calls: 2 });
      assert.deepEqual(await active(context.client), []);
      break;
    default:
      throw new Error(`Unknown probe ${name}`);
  }
}
