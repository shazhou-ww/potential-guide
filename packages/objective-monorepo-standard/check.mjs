import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { reportArguments, withCheckEvidence } from "./runtime/evidence.mjs";
import checker from "./runtime/pilot-checker.cjs";

export async function main(phase, subject, evidence, scope = "repository", dependencyProbe) {
  if (!["structure", "deliveries"].includes(phase)) {
    throw new Error("Expected structure or deliveries.");
  }
  const layer = phase === "structure" ? 1 : 2;
  if (!["repository", "package"].includes(scope)) throw new Error("Invalid standardization scope.");
  const result =
    scope === "repository"
      ? await checker.checkRepository(subject, layer, dependencyProbe)
      : { report: await checker.checkPackage(subject, layer) };
  const { report } = result;
  const problems =
    result.problems ??
    (report.state === "pass"
      ? []
      : [
          {
            kind: "internal",
            id: phase === "structure" ? "structure-incomplete" : "delivery-incomplete",
            parameters: { report },
          },
        ]);
  const requirements = result.requirements ?? [];
  const ok = problems.length === 0 && requirements.length === 0;
  for (const finding of report.findings) evidence?.fact("assertion.result", finding);
  evidence?.fact("inspection.finished", { state: report.state, layer2: report.layer2 });
  return {
    status: 200,
    payload: { ok, problems, ...(requirements.length ? { requirements } : {}) },
    message: JSON.stringify(report),
  };
}

export async function run(phase, subjectFile, scope = "repository") {
  const { options } = reportArguments(process.argv.slice(2));
  const result = await withCheckEvidence(
    `monorepo.${phase}`,
    (evidence) => runMonorepo(phase, subjectFile, evidence, scope),
    options,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
async function runMonorepo(phase, subjectFile, evidence, scope) {
  try {
    let input = "";
    if (subjectFile) input = await readFile(subjectFile, "utf8");
    else {
      for await (const chunk of process.stdin) {
        input += chunk;
        if (Buffer.byteLength(input) > 65536) throw new Error("Subject exceeds 64 KiB.");
      }
    }
    const subject = JSON.parse(input);
    evidence?.stream.protect(subject);
    return await main(phase, subject, evidence, scope);
  } catch (error) {
    return {
      status: 502,
      payload: null,
      message: `Monorepo observer invocation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { args } = reportArguments(process.argv.slice(2));
  const [phase, option, subjectFile] = args;
  if (
    !["structure", "deliveries"].includes(phase) ||
    option !== "--subject-file" ||
    !subjectFile ||
    args.length !== 3
  ) {
    process.stderr.write("Usage: node check.mjs structure|deliveries --subject-file <path>\n");
    process.exitCode = 2;
  } else await run(phase, subjectFile);
}
