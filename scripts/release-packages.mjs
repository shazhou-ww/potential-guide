export const releasePackages = [
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
    id: "objective-portfolio-supervisor",
    directory: "objective-portfolio-supervisor",
    name: "@potential-guide/objective-portfolio-supervisor",
    requiredExports: ["createPortfolioPlanner", "createPortfolioCoordinator"],
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
    id: "config",
    directory: "pguide-config",
    name: "@potential-guide/config",
    bins: ["pguide-config"],
  },
  {
    id: "pguide",
    directory: "pguide",
    name: "pguide",
    forbiddenDependencies: ["@potential-guide/objective-guide"],
    forbiddenFiles: ["dist/commands/guide.js", "dist/commands/guide.d.ts"],
    bins: [
      "pguide",
      "pguide-continue",
      "pguide-objectives",
      "pguide-probe",
      "pguide-regulate",
      "pguide-scaffold",
      "pguide-supervise",
      "pguide-validate",
    ],
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
