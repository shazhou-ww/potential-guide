import { describeWorkspace } from "@workspace/core";

export function getExampleMessage(): string {
  return describeWorkspace({
    name: "example",
    kind: "application",
  });
}
