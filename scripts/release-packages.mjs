import { join } from "node:path";

export function releasePackageDirectory({ directory, workspace }) {
  return join(workspace ?? "packages", directory);
}

export const releasePackages = [
  ...[
    "objective-monorepo-standard",
    "objective-package-standard",
    "objective-devbox-health",
    "objective-pguide-setup",
    "objective-pguide-self-check",
    "objective-setup-marker",
  ].map((directory) => ({
    id: directory,
    directory,
    name: `@potential-guide/${directory}`,
    bins: [],
    objective: true,
  })),
  {
    id: "effects",
    directory: "effects",
    name: "@potential-guide/effects",
    requiredExports: ["Effect", "Stream", "SubscriptionRef", "startEffect", "createLatestSlot"],
    bins: [],
    forbiddenDependencies: [
      "@potential-guide/cli-core",
      "@potential-guide/objective-guide",
      "@potential-guide/objective-pilot",
      "@potential-guide/objective-regulator",
    ],
  },
  {
    id: "git-source",
    directory: "git-source",
    name: "@potential-guide/git-source",
    requiredExports: ["loadGitSnapshot", "watchGitSnapshot"],
    bins: [],
    forbiddenDependencies: [
      "@potential-guide/cli-core",
      "@potential-guide/objective-guide",
      "@potential-guide/objective-pilot",
      "@potential-guide/objective-regulator",
    ],
  },
  {
    id: "objective-pilot",
    directory: "objective-pilot",
    name: "@potential-guide/objective-pilot",
    requiredExports: [
      "loadPilotSpec",
      "observe",
      "pilotBehavior",
      "parseManifest",
      "parseCheckEnvelope",
      "createProcessCheckProbe",
      "createHttpCheckProbe",
    ],
    bins: [],
    forbiddenDependencies: [
      "@potential-guide/cli-core",
      "@potential-guide/objective-guide",
      "@potential-guide/git-source",
      "@potential-guide/objective-regulator",
    ],
  },
  {
    id: "objective-regulator",
    directory: "objective-regulator",
    name: "@potential-guide/objective-regulator",
    requiredExports: ["makeRegulatorSpec", "regulate", "regulatorBehavior"],
    bins: [],
    forbiddenDependencies: ["@potential-guide/cli-core", "@potential-guide/objective-guide"],
  },
  {
    id: "regulation-coordinator",
    directory: "regulation-coordinator",
    name: "@potential-guide/regulation-coordinator",
    requiredExports: [
      "regulationCoordinator",
      "RequestModel",
      "CoordinatorModel",
      "coordinator",
      "coordinatorViews",
      "openCoordinatorStore",
    ],
    bins: [],
    forbiddenDependencies: [
      "@potential-guide/cli-core",
      "@potential-guide/objective-guide",
      "@potential-guide/objective-portfolio-supervisor",
      "@potential-guide/pguide-supervise",
    ],
  },
  {
    id: "cli-core",
    directory: "pguide-cli-core",
    name: "@potential-guide/cli-core",
    requiredExports: ["AcpClient", "COMMAND_PROTOCOL", "parseConfig", "readJsonSubject"],
    bins: [],
    forbiddenDependencies: ["@potential-guide/objective-guide", "@potential-guide/objective-pilot"],
  },
  {
    id: "pguide-config",
    directory: "pguide-config",
    name: "@potential-guide/pguide-config",
    bins: ["pguide-config"],
  },
  {
    id: "pguide-agents",
    directory: "pguide-agents",
    name: "@potential-guide/pguide-agents",
    bins: ["pguide-agents"],
  },
  {
    id: "pguide",
    directory: "pguide",
    name: "pguide",
    forbiddenDependencies: ["@potential-guide/objective-guide"],
    forbiddenRuntimeDependencies: [
      "@potential-guide/objective-regulator",
      "@potential-guide/objective-portfolio-supervisor",
      "@potential-guide/pguide-regulate",
      "@potential-guide/pguide-supervise",
    ],
    forbiddenFiles: ["dist/commands/guide.js", "dist/commands/guide.d.ts"],
    bins: ["pguide"],
  },
  {
    id: "pilot-protocol",
    directory: "pilot-protocol",
    name: "@potential-guide/pilot-protocol",
    requiredExports: [
      "parseManifest",
      "compileDomain",
      "validateSubject",
      "loadPilotSpec",
      "parseCheckEnvelope",
      "validateReferences",
      "parseObjectives",
      "projectObjective",
      "bindObjective",
      "migrateLegacyObjectiveDocument",
      "validateObjectiveDocument",
      "validateObjectivesDocument",
    ],
    bins: ["objective-contract-migrate"],
    forbiddenDependencies: [
      "@potential-guide/objective-pilot",
      "@potential-guide/cli-core",
      "@potential-guide/objective-regulator",
      "pguide",
    ],
  },
  {
    id: "cli-runtime",
    directory: "cli-runtime",
    name: "@potential-guide/cli-runtime",
    requiredExports: ["withPilot"],
    bins: [],
    forbiddenDependencies: ["@potential-guide/check-artifacts"],
    forbiddenFiles: ["js", "d.ts", "js.map", "d.ts.map"].map(
      (extension) => `dist/objective-artifact.${extension}`,
    ),
  },
  {
    id: "objective-declarations",
    directory: "objective-declarations",
    name: "@potential-guide/objective-declarations",
    requiredExports: ["selectObjective", "listObjectives", "bindObjective"],
    bins: [],
    forbiddenDependencies: [
      "@potential-guide/objective-pilot",
      "@potential-guide/objective-regulator",
      "@potential-guide/cli-runtime",
    ],
  },
  {
    id: "pguide-regulate",
    directory: "pguide-regulate",
    name: "@potential-guide/pguide-regulate",
    bins: ["pguide-regulate", "pguide-continue"],
  },
  {
    id: "pguide-objectives",
    directory: "pguide-objectives",
    name: "@potential-guide/pguide-objectives",
    bins: ["pguide-objectives"],
  },
  {
    id: "check-sdk",
    directory: "check-sdk",
    name: "@potential-guide/check-sdk",
    requiredExports: ["createCheckResult", "createCheckTask"],
    requiredFiles: [
      "references/en/check-result.md",
      "references/en/check-callback.md",
      "examples/text/build.mjs",
      "examples/text/text.check.build.yaml",
      "examples/text/src/main.ts",
      "examples/text/src/contract.ts",
    ],
    bins: [],
  },
  {
    id: "check-environment",
    directory: "check-environment",
    name: "@potential-guide/check-environment",
    requiredExports: ["checkTools", "checkDirectories", "checkNetwork"],
    generatedFiles: [
      "dist/definitions/tools.js",
      "dist/definitions/tools.d.ts",
      "dist/definitions/directories.js",
      "dist/definitions/directories.d.ts",
      "dist/definitions/network.js",
      "dist/definitions/network.d.ts",
    ],
    bins: [],
  },
];

// Local verification includes support packages without authorizing their publication.
export const verificationPackages = [
  ...releasePackages,
  {
    id: "ipfs-content",
    directory: "ipfs-content",
    name: "@potential-guide/ipfs-content",
    bins: [],
    requiredExports: ["readContentTree", "openContent", "encodeContentCar"],
  },
  {
    id: "probe-sdk",
    directory: "probe-sdk",
    name: "@potential-guide/probe-sdk",
    bins: [],
    requiredExports: ["createProbeTask"],
  },
  {
    id: "check-runtime-files",
    directory: "check-runtime-files",
    name: "@potential-guide/check-runtime-files",
    bins: [],
    requiredExports: ["readArtifact", "ensurePrivateDirectory", "closePrivateFileBackend"],
    forbiddenFiles: [
      "worker",
      "worker-json",
      "worker-types",
      "worker-source",
      "runtime-identity",
    ].flatMap((name) =>
      ["js", "d.ts", "js.map", "d.ts.map"].map((extension) => `dist/${name}.${extension}`),
    ),
  },
];

const component = "(?:0|[1-9]\\d*)";
export const releaseVersion = new RegExp(
  `^0\\.${component}\\.${component}(?:-rc\\.${component})?$`,
  "u",
);

export function parseReleaseTag(tag) {
  const selected = releasePackages.find(({ id }) => tag.startsWith(`${id}-v`));
  if (selected === undefined) throw new Error(`Unsupported package release tag: ${tag}.`);
  const version = tag.slice(selected.id.length + 2);
  if (!releaseVersion.test(version)) {
    throw new Error(`Release tags require a valid 0.x stable or RC version: ${tag}.`);
  }
  if (selected.id === "cli-core" && !version.includes("-rc."))
    throw new Error(`CLI Core releases require an RC version: ${tag}.`);
  return { ...selected, version, distTag: version.includes("-rc.") ? "rc" : "latest" };
}
