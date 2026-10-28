import { join } from "node:path";
import {
  CheckKernel,
  CheckerMaterializer,
  CheckerService,
  ContractStore,
  createServiceRouter,
  serveServices,
} from "@potential-guide/checker-host";
import { ObjectiveService } from "./service.js";

export function createObjectiveRouter(service: ObjectiveService, prefix: string) {
  return createServiceRouter(service, prefix, "objective");
}
export async function createUnifiedServices(options: {
  directory: string;
  allowedOrigins: readonly string[];
  languages: readonly string[];
}) {
  const repository = new ContractStore(options.allowedOrigins);
  const kernel = await CheckKernel.create(join(options.directory, "snapshots"));
  const checker = new CheckerService(
    repository,
    new CheckerMaterializer(join(options.directory, "execution")),
    kernel,
    options.languages,
  );
  const objective = new ObjectiveService(repository, checker, options.languages);
  return {
    checker,
    objective,
    repository,
    routers: [
      createServiceRouter(checker, "/checkers/v3", "checker"),
      createObjectiveRouter(objective, "/objectives/v1"),
    ],
    async close() {
      await objective.close();
      await checker.close();
      repository.close();
    },
  };
}
export async function serveUnifiedHost(
  options: Parameters<typeof createUnifiedServices>[0] & { token: string },
) {
  const services = await createUnifiedServices(options);
  try {
    return {
      ...services,
      ...(await serveServices(services.routers, options.token, () => services.close())),
    };
  } catch (error) {
    await services.close();
    throw error;
  }
}
