import { readFile, stat } from "node:fs/promises";
import { reportArguments, withCheckEvidence } from "../runtime/evidence.mjs";
import { Fault } from "./contract.mjs";
import { failure, invoke } from "./runner.mjs";
export async function stdin() {
  let timer;
  try {
    return await Promise.race([
      (async () => {
        let data = "";
        for await (const chunk of process.stdin) {
          data += chunk;
          if (Buffer.byteLength(data) > 2_097_152) throw new Fault("subject-input-limit.", 400);
        }
        return data;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Fault("subject-input-timeout.", 504));
          process.stdin.destroy();
        }, 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function main(stage) {
  const { args, options } = reportArguments(process.argv.slice(2));
  if (stage === undefined) stage = args.shift();
  const output = await withCheckEvidence(
    `health.${stage}`,
    (evidence) => runHealth(stage, args, evidence),
    options,
  );
  process.stdout.write(`${JSON.stringify(output)}\n`);
  return output;
}
async function runHealth(stage, args, evidence) {
  let output;
  try {
    let data;
    if (args.length === 0) data = await stdin();
    else if (args.length === 2 && args[0] === "--subject-file") {
      const info = await stat(args[1]);
      if (!info.isFile()) throw new Fault("invalid-subject-file: expected a regular file.", 400);
      if (info.size > 2_097_152) throw new Fault("subject-input-limit.", 400);
      data = await readFile(args[1], "utf8");
    } else throw new Fault("usage: health-check.mjs <stage|sample> [--subject-file path]", 400);
    let subject;
    try {
      subject = JSON.parse(data);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new Fault("invalid-subject: malformed JSON.", 400);
    }
    evidence?.stream.protect(subject);
    output = await invoke(stage, subject, evidence);
  } catch (error) {
    output = failure(error);
  }
  return output;
}
