import { type Add, type Finding, type Report, summary } from "./shared.js";

export function recorder() {
  const findings: Finding[] = [];
  const add: Add = (
    layer,
    state,
    rule,
    location,
    evidence,
    remedy,
    packages = [],
    requirements = [],
    targetDirectory,
  ) => {
    findings.push({
      layer,
      state,
      rule,
      location,
      evidence,
      remedy,
      packages,
      requirements,
      ...(targetDirectory === undefined ? {} : { targetDirectory }),
    });
  };
  const blocked = () =>
    findings.some(
      ({ layer, state }) => layer === 1 && (state === "fail" || state === "unverified"),
    );
  const report = (maxLayer: 1 | 2): Report => ({
    schemaVersion: 1,
    scope: "delivery-preparation",
    state: summary(findings),
    layer2: blocked() ? "blocked" : maxLayer === 1 ? "not-requested" : "checked",
    findings,
    evidenceKind: "configuration-and-existing-files",
    onlineVerified: false,
    limitations: [
      "Read-only static preparation: no target scripts, installs, packing, publishing or deployment.",
      "Only configuration, declared intent and existing artifacts are observed; unsupported adapters remain blocking.",
      "No secret values, transitive third-party execution, remote resources or live identity/service proofs.",
    ],
  });
  return { findings, add, blocked, report };
}
