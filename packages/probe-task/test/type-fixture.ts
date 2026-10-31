import { createProbeImplementation } from "../dist/implementation.js";
import { createProbeTaskType } from "../src/index.js";
export function createProbeFixture(options: Parameters<typeof createProbeTaskType>[0]) {
  const registration = createProbeTaskType(options);
  const implementation = createProbeImplementation(options);
  return { ...registration, ...implementation, environment: registration.environment };
}
