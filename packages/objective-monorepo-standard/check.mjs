import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import checker from "./runtime/pilot-checker.cjs";

export async function main(phase, subject) {
  if (!["structure", "deliveries"].includes(phase)) {
    throw new Error("Expected structure or deliveries.");
  }
  if (
    subject === null ||
    typeof subject !== "object" ||
    Array.isArray(subject) ||
    Object.keys(subject).some((key) => !["root", "contract", "checkerModule"].includes(key)) ||
    typeof subject.root !== "string" ||
    !isAbsolute(subject.root) ||
    typeof subject.contract !== "string" ||
    subject.contract.length === 0 ||
    (subject.checkerModule !== undefined &&
      (typeof subject.checkerModule !== "string" || !isAbsolute(subject.checkerModule)))
  ) {
    throw new Error("Subject requires absolute root and repository-relative contract paths.");
  }
  const bundledChecker = new URL("./dist/index.js", import.meta.url);
  if (
    subject.checkerModule !== undefined &&
    pathToFileURL(resolve(subject.checkerModule)).href !== bundledChecker.href
  )
    throw new Error("checkerModule must name this Pilot package's own versioned checker.");
  const report = await checker.checkMonorepo(
    subject.root,
    subject.contract,
    phase === "structure" ? 1 : 2,
  );
  const ok = report.state === "pass";
  return {
    status: 200,
    payload: ok
      ? { ok: true, problems: [] }
      : {
          ok: false,
          problems: [
            {
              id: phase === "structure" ? "structure-incomplete" : "delivery-incomplete",
              parameters: { report },
            },
          ],
        },
    message: JSON.stringify(report),
  };
}

export async function run(phase, subjectFile) {
  try {
    let input = "";
    if (subjectFile) input = await readFile(subjectFile, "utf8");
    else {
      for await (const chunk of process.stdin) {
        input += chunk;
        if (Buffer.byteLength(input) > 65536) throw new Error("Subject exceeds 64 KiB.");
      }
    }
    const result = await main(phase, JSON.parse(input));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stdout.write(
      `${JSON.stringify({ status: 422, payload: null, message: "Monorepo observer invocation failed; verify subject paths, access and build. Source values are not echoed." })}\n`,
    );
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [phase, option, subjectFile] = process.argv.slice(2);
  if (
    !["structure", "deliveries"].includes(phase) ||
    option !== "--subject-file" ||
    !subjectFile ||
    process.argv.length !== 5
  ) {
    process.stderr.write("Usage: node check.mjs structure|deliveries --subject-file <path>\n");
    process.exitCode = 2;
  } else await run(phase, subjectFile);
}
