import { MemoryStore } from "@potential-guide/task-engine/testing";

const mode = process.env.STARTUP_FAILURE_MODE;
const retained = setInterval(() => {}, 1000);
if (process.send)
  await new Promise((resolve, reject) => {
    process.once("message", (message) => {
      if (message === "trigger-startup-failure") resolve();
      else reject(new Error("Unexpected startup-failure fixture command."));
    });
    process.send({ fixture: "startup-failure-armed", mode, retainedHandle: retained.hasRef() });
  });
if (mode === "import") throw new Error("Configuration import failed with a retained handle.");

export default async function configure() {
  if (mode === "factory") throw new Error("Configuration factory failed with a retained handle.");
  return {
    store: new MemoryStore(),
    port: 0,
    bindService() {
      throw new Error("Composition startup rejected.");
    },
    authorize: () => true,
    resolveCaller: () => ({ scope: "fixture", subject: "fixture" }),
    shutdownMs: 25,
    limits: { stopGraceMs: 5, forceExitWaitMs: 5 },
    closeResources() {
      if (mode === "rollback-error") throw new Error("Composition rollback rejected.");
      return new Promise(() => {});
    },
  };
}
