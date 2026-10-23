import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { acpReady, configured } from "./configuration.mjs";
import { Fault, Problem, problem, subjectValue, success } from "./contract.mjs";
import { directSanity } from "./direct-sanity.mjs";
import { executionContext } from "./execution.mjs";
import { installation } from "./installation.mjs";
import { sanity } from "./sanity.mjs";
export async function check(stage, value, options = {}) {
  let directory;
  let timer;
  let abort;
  try {
    if (!["installation", "configuration", "sanity"].includes(stage))
      throw new Fault("usage: select installation, configuration, or sanity.", 400);
    const subject = subjectValue(value, options.selfCheck === true);
    const remote = subject.target?.type === "ssh";
    if (remote) {
      const { validateTarget } = await import("../ssh-target.mjs");
      validateTarget(subject.target);
    }
    // Legacy setup retains its separate sanity consent gate.
    if (stage === "sanity" && !options.selfCheck && subject.allowSanity !== true)
      return problem("sanity-consent-required");
    if (options.pilot === true) {
      if (remote) {
        if (subject.timeoutMs + 10000 > 24000)
          throw new Fault("outer-timeout: SSH Pilot checks require a total budget <=24000ms.", 400);
      } else {
        const metadata = options.timeoutMs === undefined ? process.env.PGUIDE_PROBE_TIMEOUT_MS : String(options.timeoutMs);
        const outerTimeoutMs = metadata === undefined ? 30000 : Number(metadata);
        if (
          (metadata !== undefined && metadata !== String(outerTimeoutMs)) ||
          !Number.isSafeInteger(outerTimeoutMs) ||
          outerTimeoutMs < 1 ||
          outerTimeoutMs > 2147483647
        )
          throw new Fault("outer-timeout: invalid PGUIDE_PROBE_TIMEOUT_MS runtime metadata.", 400);
        // The outer process also owns startup, response emission and tree/scratch cleanup.
        if (subject.timeoutMs + 6000 > outerTimeoutMs)
          throw new Fault(
            "outer-timeout: local Pilot process budget must cover timeoutMs plus 6000ms startup/cleanup reserve.",
            400,
          );
      }
    }
    if (remote) {
      const { checkSsh } = await import("../ssh-target.mjs");
      return await checkSsh(stage, subject);
    }
    const controller = new AbortController();
    abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    timer = setTimeout(
      () => controller.abort(new Fault("timeout: setup check exceeded its deadline.", 504)),
      subject.timeoutMs,
    );
    await mkdir(subject.scratchDirectory, { recursive: true });
    const probeDirectory =
      options.pilot && !options.selfCheck ? process.env.PGUIDE_PROBE_TEMP_DIR : undefined;
    if (probeDirectory !== undefined && !isAbsolute(probeDirectory))
      throw new Fault("outer-timeout: invalid PGUIDE_PROBE_TEMP_DIR runtime metadata.", 400);
    // Nested Git caches also create directories; keep Windows path headroom inside the probe.
    directory = await mkdtemp(join(probeDirectory ?? subject.scratchDirectory, "s-"));
    const context = executionContext(
      subject,
      directory,
      controller.signal,
      Date.now() + subject.timeoutMs,
      options.evidence,
    );
    if (stage === "installation")
      await context.measure("installation", () => installation(subject, context));
    else {
      const selected = await context.measure("configuration", () => configured(subject, context));
      if (!(options.selfCheck && stage === "sanity"))
        await context.measure("acp.readiness", () =>
          acpReady(selected.profile, context, directory),
        );
      if (stage === "sanity") {
        if (options.selfCheck)
          await context.measure("sanity", () => directSanity(context, directory, selected));
        else await sanity(subject, context, directory, selected);
      }
    }
    return success();
  } catch (error) {
    if (error instanceof Problem) return problem(error.id, error.parameters);
    if (error.name === "TargetFault")
      return { status: error.status, payload: null, message: error.message };
    return {
      status: error instanceof Fault ? error.status : 502,
      payload: null,
      message:
        error instanceof Fault
          ? error.message
          : "io: setup check failed; inspect paths and permissions.",
    };
  } finally {
    clearTimeout(timer);
    if (abort) options.signal?.removeEventListener("abort", abort);
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}
