import type { CheckerResult } from "@potential-guide/check-artifacts";
import type { CheckerEvidence, CheckerRequest } from "./checker-service.js";
import { ServiceTask, TaskHttpClient, type ServiceAddress } from "./service-client.js";
export { CheckerService } from "./checker-service.js";
export { createServiceRouter } from "./service-http.js";
export class CheckTask extends ServiceTask<CheckerResult, never, CheckerEvidence> {}
export class CheckTaskClient extends TaskHttpClient<
  CheckerRequest,
  CheckerResult,
  never,
  CheckerEvidence
> {
  constructor(address: ServiceAddress, prefix = "/checkers/v3") {
    super(address, prefix, "check-tasks");
  }
  async check(request: CheckerRequest, options: { idempotencyKey?: string } = {}) {
    return new CheckTask(await this.create(request, options), this);
  }
}
