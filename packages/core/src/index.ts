export interface WorkspaceIdentity {
  readonly name: string;
  readonly kind: "application" | "package";
}

export function describeWorkspace(identity: WorkspaceIdentity): string {
  const name = identity.name.trim();

  if (name.length === 0) {
    throw new TypeError("workspace name must not be empty");
  }

  const subject =
    identity.kind === "application" ? "an application" : "a package";
  return `${name} is ${subject} in this workspace.`;
}
