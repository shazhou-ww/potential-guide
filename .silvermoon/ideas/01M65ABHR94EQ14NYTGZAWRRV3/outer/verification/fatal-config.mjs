setInterval(() => {}, 1000);
export default {
  types: [{
    type: "dummy", version: "1", environment: "fixture",
    validate: (x) => x, equals: () => false, prepare: async (x) => x,
    validatePrepared: (x) => x, validateResult: (x) => x, validateProgress: (x) => x,
    execute: async () => { throw Error("Must not execute."); },
  }],
  currentVersions: { missing: "1" },
  authorize: () => true, resolveCaller: () => ({ scope: "one", subject: "operator" }),
  shutdownMs: 25, closeResources: () => new Promise(() => {}),
};
