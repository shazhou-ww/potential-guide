import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { reportArguments, withCheckEvidence } from "../runtime/evidence.mjs";
import { Fault, outputLimit } from "./contract.mjs";
import { check } from "./runner.mjs";
export async function main(stage = process.argv[2], options = {}) {
  const parsed = reportArguments(process.argv.slice(options.pilot === true ? 2 : 3));
  const output = await withCheckEvidence(
    `${options.selfCheck ? "self-check" : "setup"}.${stage}`,
    (evidence) => runSetup(stage, { ...options, evidence }, parsed.args),
    parsed.options,
  );
  console.log(JSON.stringify(output));
  return output;
}
async function runSetup(stage, options, args) {
  try {
    let source;
    if (args.length === 2 && args[0] === "--subject-file" && isAbsolute(args[1])) {
      const details = await lstat(args[1]);
      if (details.size > outputLimit)
        throw new Fault("input-limit: subject exceeded 256 KiB.", 400);
      source = await readFile(args[1], "utf8");
    } else if (args.length === 0) {
      source = "";
      const inputTimeout = setTimeout(
        () => process.stdin.destroy(new Fault("input-timeout: subject was not received.", 408)),
        5000,
      );
      try {
        for await (const chunk of process.stdin) {
          source += chunk;
          if (Buffer.byteLength(source) > outputLimit)
            throw new Fault("input-limit: subject exceeded 256 KiB.", 400);
        }
      } finally {
        clearTimeout(inputTimeout);
      }
    } else throw new Fault("usage: optional --subject-file requires an absolute path.", 400);
    let subject;
    try {
      subject = JSON.parse(source);
    } catch {
      throw new Fault("invalid-subject: expected JSON.", 400);
    }
    options.evidence?.stream.protect(subject);
    return await check(stage, subject, options);
  } catch (error) {
    return {
      status: error instanceof Fault ? error.status : 502,
      payload: null,
      message: error instanceof Fault ? error.message : "io: setup input or cleanup failed.",
    };
  }
}
