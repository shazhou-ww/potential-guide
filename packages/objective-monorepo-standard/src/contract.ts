export type Runtime = "node" | "browser" | "worker" | "tool" | "universal";
export type Role = "npm" | "cli" | "browser" | "cloudflare-worker" | "internal" | "tool";
export interface Workspace {
  path: string;
  name: string;
  roles: Role[];
  runtime: Runtime;
  allows: string[];
  entries: string[];
  sources: string[];
  tasks: string[];
}
export interface Resource {
  name: string;
  kind: "configuration" | "secret" | "resource" | "identity" | "service";
  visibility: "public" | "server";
  supply: "build" | "runtime" | "platform";
  environment: string;
}
export interface Delivery {
  id: string;
  purpose: string;
  kind: string;
  packages: string[];
  entry: { package: string; path: string };
  runtime: Runtime;
  environment?: string;
  config?: string;
  output?: string;
  resources: Resource[];
  services: string[];
  capabilities: string[];
  independent: boolean;
  migration?: { package: string; entry: string; resource: string };
}
export interface Contract {
  schemaVersion: 1;
  policy: {
    source: "pnpm-default-v1";
    packageLayers?: string;
    directories: { apps: string; packages: string; docs: string; scripts: string };
    requiredFiles: string[];
    exceptions: { path: string; reason: string }[];
    assignments: {
      path: string;
      purpose:
        | "project-doc"
        | "package-doc"
        | "script"
        | "migration"
        | "generated"
        | "tool"
        | "unknown";
      owner?: string;
      targetDirectory?: string;
      reason: string;
    }[];
    allowedDirectories: { path: string; reason: string }[];
    dependencyExceptions: { from: string; to: string; reason: string; allowCycle?: boolean }[];
  };
  workspaces: Workspace[];
  deliveries: Delivery[];
}

const text = { type: "string", minLength: 1 };
const strings = { type: "array", items: text, uniqueItems: true };
const path = {
  type: "string",
  pattern: "^(?!/|[A-Za-z]:)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//)(?!.*\\\\)(?!.*\\/$).+",
};
const paths = { type: "array", items: path, uniqueItems: true };
const runtime = { enum: ["node", "browser", "worker", "tool", "universal"] };
function object<T extends object>(properties: T, required: string[]) {
  return { type: "object", additionalProperties: false, properties, required };
}
function array(items: object) {
  return { type: "array", items };
}
const modelSchema = object(
  {
    policy: object(
      {
        source: { const: "pnpm-default-v1" },
        packageLayers: path,
        directories: object({ apps: path, packages: path, docs: path, scripts: path }, [
          "apps",
          "packages",
          "docs",
          "scripts",
        ]),
        requiredFiles: paths,
        exceptions: array(object({ path, reason: text }, ["path", "reason"])),
        assignments: array(
          object(
            {
              path,
              purpose: {
                enum: [
                  "project-doc",
                  "package-doc",
                  "script",
                  "migration",
                  "generated",
                  "tool",
                  "unknown",
                ],
              },
              owner: text,
              targetDirectory: path,
              reason: text,
            },
            ["path", "purpose", "reason"],
          ),
        ),
        allowedDirectories: array(object({ path, reason: text }, ["path", "reason"])),
        dependencyExceptions: array(
          object({ from: text, to: text, reason: text, allowCycle: { type: "boolean" } }, [
            "from",
            "to",
            "reason",
          ]),
        ),
      },
      [
        "source",
        "directories",
        "requiredFiles",
        "exceptions",
        "assignments",
        "allowedDirectories",
        "dependencyExceptions",
      ],
    ),
    deliveries: array(
      object(
        {
          id: text,
          purpose: text,
          kind: text,
          packages: { ...strings, minItems: 1 },
          entry: object({ package: text, path }, ["package", "path"]),
          runtime,
          environment: text,
          config: path,
          output: path,
          resources: array(
            object(
              {
                name: text,
                kind: { enum: ["configuration", "secret", "resource", "identity", "service"] },
                visibility: { enum: ["public", "server"] },
                supply: { enum: ["build", "runtime", "platform"] },
                environment: text,
              },
              ["name", "kind", "visibility", "supply", "environment"],
            ),
          ),
          services: strings,
          capabilities: strings,
          independent: { type: "boolean" },
          migration: object({ package: text, entry: path, resource: text }, [
            "package",
            "entry",
            "resource",
          ]),
        },
        [
          "id",
          "purpose",
          "kind",
          "packages",
          "entry",
          "runtime",
          "resources",
          "services",
          "capabilities",
          "independent",
        ],
      ),
    ),
  },
  ["policy", "deliveries"],
);
export const policySchema = modelSchema.properties.policy;
export const deliverySchema = modelSchema.properties.deliveries;
export { object, path, paths, runtime, strings, text };
