import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import {
  type Context,
  cancel,
  cancelled,
  fault,
  finishHeld,
  inspect,
  prepare,
  recover,
  running,
  startHost,
} from "./scenario.js";

export async function transition_isolated(context: Context) {
  const directory = await prepare();
  context.directory = directory;
  return async () => {
    assert.equal(context.hostActive, false, `Host cleanup unconfirmed; preserve ${directory}`);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
}
export async function transition_ready(context: Context) {
  context.hostActive = true;
  const host = await startHost(context.directory);
  context.client = host.client;
  return async () => {
    await host.close();
    context.hostActive = false;
  };
}
export async function transition_running(context: Context) {
  try {
    await running(context);
  } catch (error) {
    try {
      await finishHeld(context);
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "Partial held task initialization failed");
    }
    throw error;
  }
  return () => finishHeld(context);
}
export async function transition_cancelling(context: Context) {
  await cancel(context);
  return () => {};
}
export async function transition_cancelled(context: Context) {
  await cancelled(context);
  return () => {};
}
export async function transition_faulted(context: Context) {
  await fault(context);
  return () => {};
}
export async function transition_recovered(context: Context) {
  await recover(context);
  return () => {};
}
export const check_ready_idle = (c: Context) => inspect(c, "idle");
export const check_running_input = (c: Context) => inspect(c, "running");
export const check_cancelling_waiting = (c: Context) => inspect(c, "cancelling");
export const check_cancelled_released = (c: Context) => inspect(c, "cancelled");
export const check_faulted_failure = (c: Context) => inspect(c, "faulted");
export const check_recovered_result = (c: Context) => inspect(c, "recovered");
