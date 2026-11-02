import { createUiType } from "./worker.mjs";

export function createSmokeType(configuration, resources) {
  const type = createUiType(configuration);
  return {
    ...type,
    async run(input, context) {
      if (input.text === configuration.smokeGateText)
        await resources.invoke(context, "smoke-gate", null);
      return type.run(input, context);
    },
  };
}
