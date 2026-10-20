import type { Workspace } from "./contract.js";
import type { ReportPut } from "./shared.js";
import { type RecordValue, record, type Snapshot, taskFor, texts, under } from "./shared.js";

export async function checkDeliveryOutput(
  snapshot: Snapshot,
  outputDirectory: string,
  owner: Workspace,
  tasks: RecordValue,
  put: ReportPut,
) {
  const build = taskFor(tasks, owner.name, "build");
  if (
    !build ||
    !texts(build.outputs).some((output) =>
      under(outputDirectory, `${owner.path}/${output.replace(/\/\*\*$/, "")}`),
    )
  )
    put(
      "fail",
      "deployment-output",
      "Delivery output is not covered by the entry package's Turbo build outputs.",
      "Align build and deployment output directories.",
    );
  const outputFiles = await snapshot.files(outputDirectory).catch((error: unknown) => {
    if (record(error) && error.code === "ENOENT") return [];
    throw error;
  });
  put(
    outputFiles.length ? "pass" : "unverified",
    "delivery-artifact",
    "Only existing output files are observed; no build, deploy or migration is executed.",
    "Produce and verify artifacts separately.",
  );
}
