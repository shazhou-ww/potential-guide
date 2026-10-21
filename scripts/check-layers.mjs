import { fileURLToPath } from "node:url";
import checker from "../packages/objective-monorepo-standard/runtime/pilot-checker.cjs";

const report = await checker.checkPackageLayers(fileURLToPath(new URL("..", import.meta.url)));
const failures = report.findings.filter(({ state }) => state === "fail" || state === "unverified");
if (failures.length) {
  console.error(failures.map(({ location, evidence }) => `${location}: ${evidence}`).join("\n"));
  process.exitCode = 1;
} else console.log("Package layers: all manifests and production imports are valid.");
