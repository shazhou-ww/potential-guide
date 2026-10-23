export const releasePackages = [
  {
    id: "check-host",
    directory: "check-host",
    name: "@potential-guide/check-host",
    requiredExports: ["CheckKernel", "CheckClient", "connectHost", "readArtifact", "serve"],
    bins: ["pguide-check-host"],
    forbiddenDependencies: ["@potential-guide/objective-pilot", "@potential-guide/cli-core"],
  },
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
      "createWorkerCheckProbe",
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
    id: "objective-portfolio-supervisor",
    directory: "objective-portfolio-supervisor",
    name: "@potential-guide/objective-portfolio-supervisor",
    requiredExports: ["createPortfolioPlanner", "createPortfolioCoordinator"],
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
    forbiddenDependencies: ["@potential-guide/cli-core", "@potential-guide/objective-guide"],
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
    id: "pguide-pilot",
    directory: "pguide-pilot",
    name: "@potential-guide/pguide-pilot",
    bins: ["pguide-probe", "pguide-scaffold", "pguide-validate"],
  },
  {
    id: "pguide-regulate",
    directory: "pguide-regulate",
    name: "@potential-guide/pguide-regulate",
    bins: ["pguide-regulate", "pguide-continue"],
  },
  {
    id: "pguide-supervise",
    directory: "pguide-supervise",
    name: "@potential-guide/pguide-supervise",
    bins: ["pguide-supervise"],
  },
  {
    id: "pguide-objectives",
    directory: "pguide-objectives",
    name: "@potential-guide/pguide-objectives",
    bins: ["pguide-objectives"],
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
  return { ...selected, version, distTag: version.includes("-rc.") ? "rc" : "latest" };
}
