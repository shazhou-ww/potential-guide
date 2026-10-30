import { writeFileSync } from "node:fs";
import {
  at,
  caller,
  deferred,
  epoch,
  flush,
  harness,
  isolation,
  isTimedOut,
  policies,
  recorder,
} from "./harness.mjs";

const report = { modules: isolation(), scenarios: [] };
async function scenario(id, options, execute) {
  const h = harness(options);
  const r = recorder();
  const entry = { id, checks: r.checks, status: "running" };
  report.scenarios.push(entry);
  try {
    entry.observed = await execute(h, r);
    entry.status = "passed";
  } catch (error) {
    entry.status = "failed";
    entry.error = { name: error.name, message: error.message, stack: error.stack };
    throw error;
  } finally {
    await h.close();
    entry.closed = true;
  }
}

try {
  for (const policy of policies) {
    for (const outcome of ["completed", "failed"]) {
      const gate = deferred();
      await scenario(
        `event-${policy}-${outcome}`,
        {
          prepare: (input, index) => (index === 1 ? { ...input, preparation: 1 } : gate.promise),
        },
        async (h, r) => {
          const driver = h.submit();
          let target;
          if (policy === policies[0]) target = h.submit({ executionMatch: policy });
          await h.drive();
          if (policy === policies[1]) {
            target = h.submit({ executionMatch: policy });
            await h.drive();
          }
          r.equal("one shared work item", h.work.length, 1);
          const before = h.read(target);
          r.equal("prepare remains incomplete", before.preparation.completedAt, undefined);
          r.equal(
            "binding only at selected event",
            Boolean(before.execution),
            policy === policies[0],
          );
          const lateStart = h.submit();
          r.equal("late start same millisecond", lateStart.receivedAt, h.work[0].permit.startedAt);
          h.work[0].finish(outcome);
          const result = h.read(target);
          r.equal(
            "result outcome",
            result.stage,
            outcome === "completed" ? "completed" : "execution_failed",
          );
          r.equal(
            "shared identity",
            result.execution.executionId,
            h.read(driver).execution.executionId,
          );
          r.equal("event equality applies", result.eligibleAt, at(h.clock.now()));
          r.equal("late start cannot retrobind", h.read(lateStart).execution, undefined);
          r.equal("failure never becomes success", Boolean(result.result), outcome === "completed");
          const afterFinal = h.submit({ executionMatch: policies[1] });
          r.equal(
            "post-final same millisecond",
            afterFinal.receivedAt,
            result.termination.terminatedAt,
          );
          r.equal("post-final cannot retrobind", h.read(afterFinal).execution, undefined);
          const targetEvents = h.history(target);
          const trigger = targetEvents.find(
            (event) =>
              event.type ===
              (policy === policies[0] ? "execution.started" : `execution.${outcome}`),
          );
          const received = targetEvents.find(
            (event) => event.type === "task.created" && event.taskId === target.taskId,
          );
          const bound = targetEvents.find(
            (event) => event.type === "task.allocation.bound" && event.taskId === target.taskId,
          );
          r.truth("durable receive precedes event", received.sequence < trigger.sequence);
          r.equal("binding event time", bound.occurredAt, trigger.occurredAt);
          r.truth(
            "binding follows event in one observable prefix",
            bound.sequence > trigger.sequence,
          );
          const started = targetEvents.find((event) => event.type === "execution.started");
          const ended = targetEvents.find((event) => event.type === `execution.${outcome}`);
          const lateReceived = h.history(lateStart).find((event) => event.type === "task.created");
          r.truth(
            "late start receive follows original start",
            lateReceived.sequence > started.sequence,
          );
          const postReceived = h.history(afterFinal).find((event) => event.type === "task.created");
          r.truth(
            "post-final receive follows original final event",
            postReceived.sequence > ended.sequence,
          );
          h.engine.cancelTask(lateStart.taskId, caller);
          h.engine.cancelTask(afterFinal.taskId, caller);
          gate.resolve({ key: "shared", preparation: 99 });
          await flush();
          await h.drive();
          r.equal("late preparation does not overwrite result", h.read(target), result);
          r.equal("late preparation does not restart work", h.work.length, 1);
          return { before, ...h.evidence([driver, target, lateStart, afterFinal]) };
        },
      );
    }
  }

  for (const policy of policies) {
    for (const outcome of ["completed", "failed"]) {
      await scenario(`late-${policy}-${outcome}`, {}, async (h, r) => {
        const task = h.submit({ executionMatch: policy, timeoutMs: 10 });
        await h.drive();
        h.clock.set(Date.parse(task.deadlineAt));
        r.equal("deadline equality is on time", isTimedOut(h.read(task)), false);
        h.clock.set(Date.parse(task.deadlineAt) + 1);
        await h.drive();
        r.equal("strictly after deadline is timeout", isTimedOut(h.read(task)), true);
        r.equal("timeout alone does not reclaim running work", h.work[0].reclaims, []);
        h.work[0].finish(outcome);
        r.equal(
          "late result preserved",
          h.read(task).stage,
          outcome === "completed" ? "completed" : "execution_failed",
        );
        r.equal("late result remains timed out", isTimedOut(h.read(task)), true);
        return h.evidence([task]);
      });
    }
  }

  await scenario("requested-effective-anchors-and-idempotency", {}, async (h, r) => {
    const past = at(epoch - 500);
    const task = h.submit({ key: "past", eligibleAt: past, timeoutMs: 20 });
    const original = h.engine.getRequest(task.requestId, caller);
    r.equal("raw requested anchor retained", original.eligibleAt, past);
    r.equal("effective anchor clamped to receipt", task.eligibleAt, task.receivedAt);
    r.equal("deadline uses effective anchor", task.deadlineAt, at(epoch + 20));
    h.clock.set(epoch + 100);
    const repeated = h.engine.submit(original, caller);
    for (const key of ["taskId", "receivedAt", "eligibleAt", "deadlineAt"])
      r.equal(`idempotent ${key}`, repeated[key], task[key]);
    r.error(
      "changed intent conflicts",
      () => h.engine.submit({ ...original, key: "changed" }, caller),
      "idempotency_conflict",
    );
    const future = h.submit({ key: "future", eligibleAt: at(epoch + 200) });
    await h.drive();
    r.equal("future anchor does not launch early", h.work.length, 0);
    h.clock.set(epoch + 200);
    await h.drive();
    r.equal("future start equality", h.read(future).execution.startedAt, future.eligibleAt);
    return h.evidence([task, future]);
  });

  await scenario("expired-demand-cannot-schedule-but-can-accept", {}, async (h, r) => {
    const expired = h.submit({ timeoutMs: 1 });
    h.clock.set(epoch + 2);
    await h.drive();
    r.equal("expired demand cannot launch", h.work.length, 0);
    const driver = h.submit();
    await h.drive();
    r.equal("active demand launches once", h.work.length, 1);
    h.work[0].finish("completed");
    r.equal(
      "expired demand accepts the new start",
      h.read(expired).execution.executionId,
      h.read(driver).execution.executionId,
    );
    r.equal("expired demand completes", h.read(expired).stage, "completed");
    r.equal("expired demand still timed out", isTimedOut(h.read(expired)), true);
    return h.evidence([expired, driver]);
  });

  await scenario("cancellation-preserves-unbound-demand", {}, async (h, r) => {
    const driver = h.submit();
    await h.drive();
    const demand = h.submit({ executionMatch: policies[1] });
    h.engine.cancelTask(driver.taskId, caller);
    r.equal("unprepared demand remains unbound", h.read(demand).execution, undefined);
    r.equal("other demand prevents reclaim", h.work[0].reclaims, []);
    h.work[0].finish("completed");
    r.equal("surviving demand completes", h.read(demand).stage, "completed");
    r.truth("canceled owner stays canceled", Boolean(h.read(driver).canceledAt));
    r.equal("canceled owner receives no result", h.read(driver).result, undefined);
    return h.evidence([driver, demand]);
  });

  await scenario("timeout-preserves-other-owner", {}, async (h, r) => {
    const driver = h.submit({ timeoutMs: 1 });
    await h.drive();
    const demand = h.submit({ executionMatch: policies[1], timeoutMs: 100 });
    h.clock.set(epoch + 2);
    await h.drive();
    r.equal("first owner timed out", isTimedOut(h.read(driver)), true);
    r.equal("second owner remains timely", isTimedOut(h.read(demand)), false);
    r.equal("second owner not prematurely bound", h.read(demand).execution, undefined);
    r.equal("no reclaim for one timeout", h.work[0].reclaims, []);
    h.work[0].finish("failed");
    r.equal(
      "both owners receive actual failure",
      [h.read(driver).stage, h.read(demand).stage],
      ["execution_failed", "execution_failed"],
    );
    r.equal(
      "timeout remains independent",
      [isTimedOut(h.read(driver)), isTimedOut(h.read(demand))],
      [true, false],
    );
    return h.evidence([driver, demand]);
  });

  await scenario("last-unbound-owner-cancellation-releases", {}, async (h, r) => {
    const task = h.submit({ executionMatch: policies[1] });
    await h.drive();
    r.equal("running work is not a result binding", h.read(task).execution, undefined);
    h.engine.cancelTask(task.taskId, caller);
    await h.engine.waitForTaskRelease(task.taskId, caller);
    r.equal("last owner causes one cooperative reclaim", h.work[0].reclaims.length, 1);
    r.truth("task stays canceled", Boolean(h.read(task).canceledAt));
    r.equal("reclaim does not create canceled task result", h.read(task).result, undefined);
    return h.evidence([task]);
  });

  await scenario("type-equals-not-prepared-or-json-equality", {}, async (h, r) => {
    const first = h.submit({ key: "Equivalent" });
    const second = h.submit({ key: "equivalent" });
    await h.drive();
    r.equal("custom equals shares distinct raw Inputs", h.work.length, 1);
    r.equal(
      "shared execution",
      h.read(first).execution.executionId,
      h.read(second).execution.executionId,
    );
    h.work[0].finish("completed");
    return h.evidence([first, second]);
  });

  await scenario(
    "prepared-late-requests-cannot-rebind-running-or-historical-work",
    {
      prepare: (input) => ({ key: input.key }),
    },
    async (h, r) => {
      const first = h.submit();
      await h.drive();
      const lateStart = h.submit();
      await h.drive();
      r.equal("late start receives a distinct new execution", h.work.length, 2);
      r.equal(
        "late start never joins the already-started execution",
        h.read(lateStart).execution.executionId === h.read(first).execution.executionId,
        false,
      );
      h.work[0].finish("completed");
      const lateTerm = h.submit({ executionMatch: policies[1] });
      await h.drive();
      const pending = h.read(lateTerm);
      r.truth("post-final request fully prepared", Boolean(pending.preparation.completedAt));
      r.equal(
        "prepared post-final request cannot take historical result",
        pending.execution,
        undefined,
      );
      r.equal(
        "terminated demand uses ongoing work without launching a third execution",
        h.work.length,
        2,
      );
      h.work[1].finish("completed");
      r.equal(
        "only the later termination can bind it",
        h.read(lateTerm).execution.executionId,
        h.read(lateStart).execution.executionId,
      );
      r.equal(
        "all events deliberately share one timestamp",
        new Set(h.evidence([first, lateStart, lateTerm]).events.map((event) => event.occurredAt))
          .size,
        1,
      );
      return { pending, ...h.evidence([first, lateStart, lateTerm]) };
    },
  );

  await scenario("obsolete-enum-rejected", {}, async (h, r) => {
    const task = h.submit({ key: "valid" });
    const invalid = {
      ...h.engine.getRequest(task.requestId, caller),
      requestId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      executionMatch: "completed-after-eligible",
    };
    r.error("old enum is not an alias", () => h.engine.submit(invalid, caller), "invalid_request");
    r.error(
      "rejected request was not accepted",
      () => h.engine.getRequest(invalid.requestId, caller),
      "not_found",
    );
    return { invalid, ...h.evidence([task]) };
  });
} catch (error) {
  report.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      scenarios: report.scenarios.length,
      failed: report.scenarios.filter((item) => item.status !== "passed").length,
    }),
  );
}
