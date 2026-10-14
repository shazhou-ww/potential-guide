import { describe, expect, it } from "vitest";

import { getExampleMessage } from "../src/index.js";

describe("getExampleMessage", () => {
  it("uses the shared core package", () => {
    expect(getExampleMessage()).toBe(
      "example is an application in this workspace.",
    );
  });
});
