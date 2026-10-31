import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type ArtifactReference,
  canonicalJson,
  validateArtifactReference,
} from "@potential-guide/check-artifacts/contracts";
import { authorizeSync, json, positive, type RegisteredType } from "@potential-guide/task-protocol";
import type { CheckTaskOptions } from "./implementation.js";
import { checkInputSchema, checkResultSchema } from "./input.js";

export type { CheckInput, CheckPrepared, CheckTaskOptions } from "./implementation.js";
export {
  artifactDigestSchema,
  artifactHttpsUrlSchema,
  artifactReferenceSchema,
  checkInputSchema,
  validateCheckInput,
} from "./input.js";
export {
  type ArtifactSource,
  type ArtifactSourceOptions,
  createArtifactSource,
} from "./prepare.js";

export function createCheckTaskType(
  options: CheckTaskOptions,
): RegisteredType & { close(): Promise<void> } {
  const configuration = {
    directory: options.directory,
    version: options.version ?? "2",
    languages: [...(options.languages ?? ["en"])],
    workers: positive(options.workers ?? 4, "workers"),
    wallMs: positive(options.wallMs ?? 60_000, "wallMs"),
    cleanupMs: positive(options.cleanupMs ?? 5_000, "cleanupMs"),
    graceMs: positive(options.graceMs ?? 100, "graceMs"),
    memoryMb: positive(options.memoryMb ?? 256, "memoryMb"),
    environment: { ...options.environment },
  };
  const module = new URL(
    import.meta.url.endsWith(".ts") ? "../dist/implementation.js" : "./implementation.js",
    import.meta.url,
  );
  const { directory: _directory, ...environmentConfiguration } = configuration;
  const environment = canonicalJson({
    type: "check-run-v3",
    node: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    revision: createHash("sha256")
      .update(readFileSync(module))
      .update(readFileSync(new URL("./worker.js", module)))
      .digest("hex"),
    configuration: createHash("sha256")
      .update(canonicalJson(json(environmentConfiguration)))
      .digest("hex"),
  });
  const action = (value: unknown, scope: string) => {
    const reference = value as ArtifactReference;
    validateArtifactReference(reference);
    authorizeSync(() => options.source.authorize(reference, scope));
    return reference;
  };
  return {
    type: "check",
    version: configuration.version,
    environment,
    inputSchema: checkInputSchema,
    resultSchema: checkResultSchema,
    messageSchema: false,
    module: module.href,
    exportName: "createIsolatedCheck",
    verifyExportName: "verifyIsolatedCheck",
    configuration: json(configuration),
    resources: {
      async authorize(value, context) {
        action(value, context.scope);
        return null;
      },
      async resolve(value, context) {
        const artifact = await options.source.resolve(
          action(value, context.scope),
          context.scope,
          context.signal,
        );
        return {
          files: Object.fromEntries(
            [...artifact.files].map(([path, bytes]) => [path, bytes.toString("base64")]),
          ),
        };
      },
    },
    async close() {},
  };
}
