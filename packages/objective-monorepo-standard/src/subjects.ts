import { isAbsolute, resolve } from "node:path";
import type { JsonObject } from "@potential-guide/objective-pilot";
import { Ajv } from "ajv";
import {
  type Contract,
  type Delivery,
  deliverySchema,
  object,
  path,
  paths,
  policySchema,
  type Role,
  type Runtime,
  runtime,
  strings,
  text,
} from "./contract.js";

export interface PackageSubject {
  root: string;
  directory: string;
  roles: Role[];
  runtime: Runtime;
  allows: string[];
  entries: string[];
  generated: { path: string; reason: string }[];
  joins: { id: string; kind: string }[];
  deliveries: Delivery[];
}
export interface RepositorySubject {
  context: {
    repository: { id: string };
    checkout: { id: string; rootPath: string };
    directory: { absolutePath: string; relativePath: string };
  };
  policy: Contract["policy"];
  deliveries: Delivery[];
}
export const packageSubjectSchema = object(
  {
    root: text,
    directory: path,
    roles: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { enum: ["npm", "cli", "browser", "cloudflare-worker", "internal", "tool"] },
    },
    runtime,
    allows: strings,
    entries: paths,
    generated: { type: "array", items: object({ path, reason: text }, ["path", "reason"]) },
    joins: { type: "array", items: object({ id: text, kind: text }, ["id", "kind"]) },
    deliveries: deliverySchema,
  },
  [
    "root",
    "directory",
    "roles",
    "runtime",
    "allows",
    "entries",
    "generated",
    "joins",
    "deliveries",
  ],
);
export const repositorySubjectSchema = object(
  {
    context: object(
      {
        repository: object({ id: text }, ["id"]),
        checkout: object({ id: text, rootPath: text }, ["id", "rootPath"]),
        directory: object({ absolutePath: text, relativePath: text }, [
          "absolutePath",
          "relativePath",
        ]),
      },
      ["repository", "checkout", "directory"],
    ),
    policy: policySchema,
    deliveries: deliverySchema,
  },
  ["context", "policy", "deliveries"],
);

const ajv = new Ajv({ allErrors: true, strict: true });
const packageValidator = ajv.compile<PackageSubject>(packageSubjectSchema);
const repositoryValidator = ajv.compile<RepositorySubject>(repositorySubjectSchema);
export function parsePackageSubject(value: unknown): PackageSubject {
  if (!packageValidator(value))
    throw new Error(`Invalid package subject: ${ajv.errorsText(packageValidator.errors)}`);
  if (!isAbsolute(value.root)) throw new Error("Package root must be absolute.");
  return value;
}
export function parseRepositorySubject(value: unknown): RepositorySubject {
  if (!repositoryValidator(value))
    throw new Error(`Invalid repository subject: ${ajv.errorsText(repositoryValidator.errors)}`);
  if (
    !isAbsolute(value.context.checkout.rootPath) ||
    !isAbsolute(value.context.directory.absolutePath) ||
    resolve(value.context.directory.absolutePath) !== resolve(value.context.checkout.rootPath) ||
    value.context.directory.relativePath !== "."
  )
    throw new Error("Repository standardize must bind the checkout root directory.");
  return value;
}
export function packageContext(
  subject: RepositorySubject,
  directory: string,
  absolutePath: string,
): JsonObject {
  return {
    repository: subject.context.repository,
    checkout: subject.context.checkout,
    directory: { absolutePath, relativePath: directory },
  };
}
export const defaultPolicy: Contract["policy"] = {
  source: "pnpm-default-v1",
  directories: { apps: "apps", packages: "packages", docs: "docs", scripts: "scripts" },
  requiredFiles: [],
  exceptions: [],
  assignments: [],
  allowedDirectories: [],
  dependencyExceptions: [],
};
