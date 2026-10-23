import { randomUUID } from "node:crypto";
import type { CheckState, StartCheck } from "./types.js";
import { HostError, terminal } from "./types.js";

export interface HostAddress {
  endpoint: string;
  token: string;
  pid: number;
  instance: string;
}
export class CheckClient {
  constructor(readonly address: HostAddress) {
    const url = new URL(address.endpoint);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password)
      throw new Error("Check Host must be authenticated loopback HTTP.");
  }
  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.address.endpoint}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.address.token}`, ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new HostError(response.status, text.slice(0, 2048));
    }
    return response;
  }
  async start(request: Omit<StartCheck, "checkId"> & { checkId?: string }): Promise<string> {
    const checkId = request.checkId ?? `${this.address.instance}:${randomUUID()}`;
    try {
      await this.request("/checks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, checkId }),
      });
    } catch (error) {
      // A lost acceptance response is recovered by observation, never by re-execution.
      if (error instanceof HostError) throw error;
      try {
        await this.sample(checkId);
      } catch {
        throw new Error(`Start outcome unknown for ${checkId}: ${String(error)}`);
      }
    }
    return checkId;
  }
  async sample(checkId: string): Promise<CheckState> {
    return (
      await this.request(`/checks/${encodeURIComponent(checkId)}`)
    ).json() as Promise<CheckState>;
  }
  async cancel(checkId: string): Promise<CheckState> {
    return (
      await this.request(`/checks/${encodeURIComponent(checkId)}/cancel`, { method: "POST" })
    ).json() as Promise<CheckState>;
  }
  async wait(checkId: string, signal?: AbortSignal): Promise<CheckState> {
    const response = await this.request(`/checks/${encodeURIComponent(checkId)}`, {
      headers: { accept: "application/x-ndjson" },
      signal: signal ?? AbortSignal.timeout(120_000),
    });
    if (!response.body) throw new Error("Check state stream unavailable.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) throw new Error(`Check state unknown after disconnect: ${checkId}`);
        pending += decoder.decode(value, { stream: true });
        if (pending.length > 16 * 1024 * 1024) throw new Error("Check state exceeds limit.");
        let end = pending.indexOf("\n");
        while (end >= 0) {
          const state = JSON.parse(pending.slice(0, end)) as CheckState;
          pending = pending.slice(end + 1);
          if (state.checkId !== checkId) throw new Error("Check state identity mismatch.");
          if (terminal(state)) return state;
          end = pending.indexOf("\n");
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  async execute(request: Omit<StartCheck, "checkId">, signal: AbortSignal) {
    signal.throwIfAborted();
    const id = await this.start(request);
    const cancel = () => {
      void this.cancel(id).catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      // Cancellation owns an explicit RPC and waits for cleanup; observation disconnect alone does not.
      const result = await this.wait(id);
      signal.throwIfAborted();
      return result;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
}
