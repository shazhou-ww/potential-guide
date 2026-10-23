import { Fault, stages, validateSubject } from "./contract.mjs";
import { identity } from "./identity.mjs";
import { order } from "./order.mjs";
import { localSample, sustainability } from "./sustainability.mjs";
import { system } from "./system.mjs";
import { toolchains } from "./toolchains.mjs";
import { remote } from "./transport.mjs";
export function failure(error) {
  return {
    status: error instanceof Fault ? error.status : 500,
    payload: null,
    message:
      error instanceof Fault
        ? error.message
        : `health-check-fault: ${error.code ?? error.name}: ${error.message}`,
  };
}
export async function invoke(stage, value, evidence, options = {}) {
  try {
    if (![...stages, "sample"].includes(stage)) throw new Fault("invalid-stage.", 400);
    const subject = validateSubject(value);
    if (subject.target.type === "docker") return await remote(stage, subject, options);
    if (process.platform !== "linux")
      throw new Fault("unsupported-platform: local execution requires Linux (Debian/Ubuntu).", 501);
    const context = {
      deadline: Math.min(options.deadline ?? Infinity, Date.now() + 24000),
      evidence,
      signal: options.signal,
    };
    evidence?.fact("stage.started", { stage });
    if (stage === "sample")
      return { status: 200, payload: await localSample(subject, context), message: "" };
    const result = await { identity, system, toolchains, order, sustainability }[stage](
      subject,
      context,
    );
    evidence?.fact("assertion.result", { stage, result });
    return result;
  } catch (error) {
    return failure(error);
  }
}
export async function check(stage, subject, options = {}) {
  if (!stages.includes(stage))
    return failure(new Fault("invalid-stage: sample is not a Pilot check.", 400));
  return invoke(stage, subject, options.evidence, options);
}
export async function sample(subject) {
  return invoke("sample", subject);
}
