import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

test("read-only and fixture-class imports do not load author codecs or the Kubo RPC client", async () => {
  const loader = `export async function resolve(specifier, context, next) {
    if (specifier.startsWith("@helia/") || specifier === "kubo-rpc-client")
      throw new Error("Read-only startup must not load " + specifier);
    return next(specifier, context);
  }`;
  const source = `
    import {register} from "node:module";
    register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(loader)}`)}, import.meta.url);
    const reader = await import(${JSON.stringify(new URL("../dist/read.js", import.meta.url).href)});
    const fixtures = await import(${JSON.stringify(new URL("../dist/testing.js", import.meta.url).href)});
    if (typeof reader.createIpfsGatewayClient !== "function" ||
        typeof fixtures.MemoryIpfsClient !== "function" ||
        "createIpfsClient" in reader || "encodeContentCar" in reader)
      throw new Error("Content interface boundaries changed");
    console.log("read-only");
  `;
  const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", source]);
  assert.equal(result.stdout.trim(), "read-only");
});
