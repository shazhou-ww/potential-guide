import type { Workspace } from "./contract.js";
import type { ReportPut } from "./shared.js";
import {
  matches,
  type RecordValue,
  record,
  type Snapshot,
  secretPath,
  texts,
  under,
} from "./shared.js";

export async function checkPackagePublication(
  snapshot: Snapshot,
  workspace: Workspace,
  manifest: RecordValue,
  inventory: string[],
  put: ReportPut,
) {
  if (
    workspace.roles.some((role) => ["internal", "tool"].includes(role)) &&
    !workspace.roles.includes("npm")
  )
    put(
      manifest.private === true ? "pass" : "fail",
      "internal-role",
      "Internal/tool packages must explicitly be private in pnpm-default-v1.",
      "Set private:true or declare a public package role instead.",
    );
  if (workspace.roles.includes("npm")) {
    put(
      manifest.private !== true &&
        typeof manifest.version === "string" &&
        record(manifest.publishConfig) &&
        manifest.publishConfig.access === "public"
        ? "pass"
        : "fail",
      "npm-identity",
      "Public npm identity, version and access metadata.",
      "Declare public publish metadata without publishing.",
    );
    const exports = texts(manifest.exports);
    const definitionOnly =
      exports.length === 1 &&
      exports[0] === "./objective.yaml" &&
      manifest.main === undefined &&
      manifest.types === undefined;
    const cliOnly = workspace.roles.includes("cli") && exports.length === 0;
    put(
      cliOnly ? "not-applicable" : exports.length > 0 ? "pass" : "fail",
      "npm-exports",
      cliOnly
        ? "Executable-only npm packages do not need a JavaScript library export."
        : "Public library exports must be explicit.",
      "Declare package entry exports.",
    );
    const publishing = record(manifest.publishConfig) ? manifest.publishConfig : {};
    put(
      typeof publishing.tag === "string" || publishing.tag === undefined ? "pass" : "fail",
      "npm-channel",
      `Configured npm channel is ${typeof publishing.tag === "string" ? publishing.tag : "latest (npm default)"}; release-command overrides are not executed.`,
      "Declare a valid publishConfig.tag or validate the release workflow separately.",
    );
    const files = texts(manifest.files);
    const sensitiveFiles = inventory.filter(
      (file) =>
        under(file, workspace.path) &&
        secretPath.test(file) &&
        !/(?:^|\/)(?:\.npmrc|\.env\.(?:example|sample|template))$/.test(file) &&
        files.some(
          (pattern) =>
            under(
              file.slice(workspace.path.length + 1),
              pattern.replace(/^\.\//, "").replace(/\/\*\*$/, ""),
            ) || matches(file.slice(workspace.path.length + 1), pattern),
        ),
    );
    for (const file of sensitiveFiles)
      put(
        "unverified",
        "npm-sensitive-file",
        "Publish scope contains a potentially sensitive file; only its path was observed, not its values.",
        "Remove secret-value files from publish scope or use a supported non-secret template convention.",
        file,
      );
    put(
      files.length > 0 &&
        !files.some((file) => secretPath.test(file) || file === "." || file === "**")
        ? "pass"
        : "fail",
      "npm-files",
      "Publish allowlist must be bounded and exclude secret-value paths.",
      "Declare precise publish paths.",
    );
    for (const file of [...exports, ...texts(manifest.types)]) {
      if (!file.startsWith("./") || file.includes("*")) {
        put(
          "unverified",
          "npm-export-target",
          "Conditional/pattern target is outside supported literal export targets.",
          "Provide literal targets or extend the observer.",
        );
        continue;
      }
      const included = files.some(
        (pattern) =>
          under(file.slice(2), pattern.replace(/^\.\//, "").replace(/\/\*\*$/, "")) ||
          matches(file.slice(2), pattern),
      );
      if (!included)
        put(
          "fail",
          "npm-content",
          `Public target ${file} is outside publish files.`,
          "Include the public target.",
        );
      try {
        put(
          (await snapshot.exists(`${workspace.path}/${file}`)) ? "pass" : "unverified",
          "npm-artifact",
          `Existing file check for public target ${file}; no pack/build executed.`,
          "Build/pack separately in an authorized environment; metadata is not consumption proof.",
        );
      } catch (error) {
        put("unverified", "npm-artifact", String(error), "Use a safe regular artifact.");
      }
    }
    if (cliOnly || definitionOnly)
      put(
        "not-applicable",
        "npm-types",
        definitionOnly
          ? "Objective-definition-only npm package has no public JavaScript typing surface."
          : "Executable-only npm package has no public library typing surface.",
      );
    else if (!texts(manifest.types).length && !exports.some((file) => /\.d\.[cm]?ts$/.test(file)))
      put(
        "unverified",
        "npm-types",
        "No type declaration evidence.",
        "Provide types or establish that declarations are not applicable.",
      );
  }
}
