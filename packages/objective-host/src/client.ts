import { ServiceTask, TaskHttpClient, type ServiceAddress } from "@potential-guide/checker-host";
import type { ObjectiveObservation, ProbeEvidence, ProbeProgress, ProbeRequest } from "./types.js";
export class ProbeTask extends ServiceTask<ObjectiveObservation, ProbeProgress, ProbeEvidence> {}
export class ObjectiveTaskClient extends TaskHttpClient<
  ProbeRequest,
  ObjectiveObservation,
  ProbeProgress,
  ProbeEvidence
> {
  constructor(address: ServiceAddress, prefix = "/objectives/v1") {
    super(address, prefix, "probe-tasks");
  }
  async probe(request: ProbeRequest, options: { idempotencyKey?: string } = {}) {
    return new ProbeTask(await this.create(request, options), this);
  }
}
