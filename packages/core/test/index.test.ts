import { describe, expect, it } from "vitest";

import { describeWorkspace } from "../src/index.js";

describe("describeWorkspace", () => {
  it.each([
    ["example", "application", "example is an application in this workspace."],
    ["core", "package", "core is a package in this workspace."],
  ] as const)("describes %s", (name, kind, expected) => {
    expect(describeWorkspace({ name, kind })).toBe(expected);
  });

  it("rejects an empty name", () => {
    expect(() =>
      describeWorkspace({
        name: " ",
        kind: "package",
      }),
    ).toThrowError(new TypeError("workspace name must not be empty"));
  });
});
