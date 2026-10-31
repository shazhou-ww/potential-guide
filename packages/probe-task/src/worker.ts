import { parentPort, workerData } from "node:worker_threads";
import { observeObjective } from "@potential-guide/check-artifacts/observation";
import {
  decodeObjective,
  decodePrepared,
  type ProbeEffectEvidence,
  type ProbePolicy,
  type ProbePrepared,
} from "./contracts.js";

const port = parentPort!;
const data = workerData as {
  prepared: ProbePrepared;
  policy: ProbePolicy;
  runId: string;
  startedAt: string;
};
const root = decodePrepared(data.prepared, data.prepared.environment, data.policy);
const iterator = observeObjective(root, data.prepared.input, {
  languages: data.policy.languages,
  policy: data.policy,
  observedAt: data.startedAt,
  progress: (value) => port.postMessage({ kind: "progress", value }),
});
const operations: ProbeEffectEvidence[] = [];
let current = iterator.next();
function advance() {
  if (current.done) {
    port.postMessage({
      kind: "result",
      value: {
        observation: current.value,
        references: root.pages,
        evidence: {
          parentRunId: data.runId,
          prepared: data.prepared,
          startedAt: data.startedAt,
          environment: data.prepared.environment,
          operations,
        },
      },
    });
    port.close();
  } else port.postMessage({ kind: "effect", value: current.value });
}
port.on("message", (entry: ProbeEffectEvidence) => {
  if (current.done) throw new Error("Unexpected completed observation response.");
  operations.push(entry);
  current = iterator.next(
    "content" in entry
      ? decodeObjective(
          entry.content,
          entry.request.reference,
          data.policy.languages,
          root.language,
        )
      : {
          result: (entry.snapshot.result as unknown as { result: never }).result,
          taskId: entry.snapshot.taskId,
          executionId: (
            entry.snapshot.result as unknown as { evidence: { execution: { executionId: string } } }
          ).evidence.execution.executionId,
        },
  );
  advance();
});
advance();
