import { MemoryStore } from "@potential-guide/task-engine/testing";
import { json } from "@potential-guide/task-protocol";

const mode = process.env.STARTUP_FAILURE_MODE;
setInterval(() => {}, 1000);
if (mode === "import") throw new Error("Configuration import failed with a retained handle.");

export default async function configure() {
  if (mode === "factory") throw new Error("Configuration factory failed with a retained handle.");
  return {
    store: new MemoryStore(),
    port: 0,
    types: [
      {
        type: "fixture",
        version: "1",
        environment: "test",
        validate: json,
        equals: () => false,
        prepare: async (value) => value,
        validatePrepared: json,
        validateResult: json,
        validateProgress: json,
        execute: async () => {
          throw new Error("Invalid configuration must not execute work.");
        },
      },
    ],
    currentVersions: { missing: "1" },
    authorize: () => true,
    resolveCaller: () => ({ scope: "fixture", subject: "fixture" }),
    shutdownMs: 25,
    closeResources() {
      if (mode === "rollback-error") throw new Error("Composition rollback rejected.");
      return new Promise(() => {});
    },
  };
}
