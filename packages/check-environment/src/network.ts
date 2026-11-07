import { languages, problemCodes } from "../dist/definitions/network.js";
import { executeCommand } from "./command.js";
import {
  type CheckContext,
  type CheckItem,
  type CheckResultContext,
  problems,
  result,
  timeoutValue,
} from "./result.js";

export interface NetworkInput {
  dns: string[];
  http: { url: string; expectedStatus: number[]; followRedirects: boolean }[];
  checkTimeoutMs?: number;
}

export async function inspectNetwork(input: NetworkInput, context: CheckContext = {}) {
  if (
    (!input.dns.length && !input.http.length) ||
    input.dns.length > 100 ||
    input.http.length > 100
  )
    throw new Error("Specify DNS or HTTP checks, with at most 100 of each.");
  const timeout = timeoutValue(input.checkTimeoutMs);
  for (const host of input.dns)
    if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(host)) throw new Error("Invalid DNS name.");
  for (const endpoint of input.http) {
    const url = new URL(endpoint.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !endpoint.expectedStatus.length ||
      endpoint.expectedStatus.some(
        (status) => !Number.isInteger(status) || status < 100 || status > 599,
      )
    )
      throw new Error(
        "HTTP checks require HTTP(S) URLs without credentials and valid status codes.",
      );
  }
  const checks: CheckItem<(typeof problemCodes)[number]>[] = [];
  for (const host of input.dns) {
    // A subprocess bounds native DNS lookup lifetime, including cancellation.
    const source =
      "import{lookup}from'node:dns/promises';try{const r=await lookup(process.argv[1]);console.log(JSON.stringify({ok:true,actual:r.address}));}catch(e){if(!['ENOTFOUND','EAI_AGAIN','EAI_FAIL','ETIMEOUT'].includes(e.code))throw e;console.log(JSON.stringify({ok:false,actual:e.code}));}";
    const output = await executeCommand(
      process.execPath,
      ["--input-type=module", "-e", source, host],
      timeout,
      context.signal,
    );
    if (output.code !== 0) throw new Error(`DNS check process failed: ${output.stderr}`);
    const value: { ok: boolean; actual: string } = JSON.parse(output.stdout);
    checks.push({
      target: host,
      ok: value.ok,
      code: value.ok ? "pass" : "dns-unavailable",
      actual: value.actual,
    });
  }
  for (const endpoint of input.http) {
    context.signal?.throwIfAborted();
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeout),
      ...(context.signal ? [context.signal] : []),
    ]);
    let check: CheckItem<(typeof problemCodes)[number]>;
    try {
      const response = await fetch(endpoint.url, {
        redirect: endpoint.followRedirects ? "follow" : "manual",
        signal,
      });
      try {
        const ok =
          endpoint.expectedStatus.includes(response.status) &&
          (endpoint.followRedirects || response.status < 300 || response.status >= 400);
        check = {
          target: endpoint.url,
          ok,
          code: ok ? "pass" : "http-status",
          actual: String(response.status),
        };
      } finally {
        await response.body?.cancel();
      }
    } catch (error) {
      context.signal?.throwIfAborted();
      if (error instanceof Error && error.name === "TimeoutError")
        throw new Error("HTTP check timed out.", { cause: error });
      if (!(error instanceof TypeError)) throw error;
      check = { target: endpoint.url, ok: false, code: "http-unavailable", actual: error.message };
    }
    checks.push(check);
  }
  return problems(checks);
}

export async function checkNetwork(input: NetworkInput, context: CheckResultContext) {
  return result(problemCodes, await inspectNetwork(input, context), {
    cid: context.bundle.cid,
    languages,
  });
}

export default checkNetwork;
