import assert from "node:assert/strict";
import test from "node:test";
import { validateCheckInput } from "@potential-guide/check-task";
import { validateProbeInput } from "../src/index.js";
import { harness, rootUrl, wait } from "./fixtures.js";

test("known URL paths reject credential-bearing and normalization-bypass inputs before persistence", async () => {
  const h = await harness();
  try {
    const urls = [
      ...[
        "token",
        "TOKEN",
        "aPiKeY",
        "api_key",
        "api-key",
        "apiXkey",
        "Sig",
        "password",
        "credential",
        "secret",
        "signature",
        "%74oken",
        "to%6ben",
        "%2574oken",
        "api+key",
        "safe%26token",
        "safe;token",
      ].map((key) => `https://example.test/a?${key}=value`),
      "https://user:password@example.test/a",
      "https://user@example.test/a",
      "https://example.test/a#token",
      "https://example.test\\@other.test/a",
      "https://example.test/\n?token=value",
      "https://example.test/a?x=1&token=value",
      "file:///a?token=value",
      "file://user:password@host/a",
    ];
    for (const url of urls) {
      assert.throws(
        () => validateCheckInput({ checker: { kind: "checker", url }, subject: {} }),
        { code: "invalid_input" },
        url,
      );
      assert.throws(
        () => validateProbeInput({ objective: { kind: "objective", url }, subject: {} }),
        { code: "invalid_input" },
        url,
      );
      assert.throws(
        () => h.submit({ objective: { kind: "objective", url } }),
        { code: "invalid_input" },
        url,
      );
      assert.throws(
        () => h.submit({ bindings: { [url]: `sha256:${"a".repeat(64)}` } }),
        { code: "invalid_input" },
        url,
      );
    }
    assert.equal(h.store.read().facts.watermark, 0);
    validateCheckInput({ checker: { kind: "checker", url: "file:///C:/check.tar" }, subject: {} });
    validateProbeInput({
      objective: { kind: "objective", url: "https://example.test/a?v=1&name=value%20x" },
      subject: {},
    });
  } finally {
    await h.close();
  }
});

test("Probe digest conflicts become preparation_failed after authorization but before resolution", async () => {
  let authorizations = 0;
  let resolutions = 0;
  const h = await harness(undefined, {
    source: {
      authorize() {
        authorizations++;
      },
      async resolve() {
        resolutions++;
        throw new Error("unexpected download");
      },
    },
  });
  try {
    const input = {
      objective: { kind: "objective", url: rootUrl, digest: `sha256:${"a".repeat(64)}` },
      subject: {},
      bindings: { [rootUrl]: `sha256:${"b".repeat(64)}` },
    };
    validateProbeInput(input);
    const task = h.submit(input);
    const final = await wait(
      () => h.read(task),
      (snapshot) => snapshot.stage === "run_failed",
    );
    assert.equal(final.error?.code, "invalid_probe");
    assert.match(final.error!.message, /Root binding conflict/);
    assert.equal(authorizations, 0, "输入自身冲突在实际资源动作前拒绝，不再逐 Task 授权。");
    assert.equal(resolutions, 0);
    assert.equal(Object.keys(h.store.read().facts.runs).length, 1);
    assert.equal(Object.keys(h.store.read().facts.tasks).length, 1);
    assert.throws(
      () =>
        h.probe.validatePrepared({
          input,
          environment: h.probe.environment,
          root: {},
        }),
      /Root binding conflict/,
    );
  } finally {
    await h.close();
  }
});
