import { createCheckImplementation } from "../dist/implementation.js";
import { createCheckTaskType } from "../src/index.js";

// 对业务复验的单元调用与静态 Worker 注册分开，Engine 仅收到注册项。
export function createCheckFixture(options: Parameters<typeof createCheckTaskType>[0]) {
  const registration = createCheckTaskType(options);
  const implementation = createCheckImplementation(options);
  return { ...registration, ...implementation, environment: registration.environment };
}
