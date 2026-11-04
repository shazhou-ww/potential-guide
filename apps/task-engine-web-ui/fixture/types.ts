import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTaskBundle } from "@potential-guide/pguide-task-bundle/build";
import { importTaskBundle } from "@potential-guide/pguide-task-bundle/publish";
import { newId } from "@potential-guide/task-engine";
import { MemoryIpfsClient } from "@potential-guide/task-engine/testing";
import type { RegisteredType } from "@potential-guide/task-protocol";
import {
  type BundleReference,
  type Caller,
  TaskError,
  type TaskService,
  taskSchemaUri,
} from "@potential-guide/task-protocol";
import type { Parameters } from "../src/model.js";

export function fixtureTypes() {
  const base = {
    version: "1",
    environment: "web-ui-fixture-v3",
    resultSchema: true,
    messageSchema: false,
    module: new URL("./worker.mjs", import.meta.url).href,
    exportName: "createUiType",
    configuration: {},
  };
  const types: RegisteredType[] = [
    {
      ...base,
      type: "echo",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: { type: "string", minLength: 1, title: "消息" },
          durationMs: { type: "integer", minimum: 1, maximum: 60000 },
          metadata: { type: "object", title: "自由对象" },
        },
      },
    },
    {
      ...base,
      type: "survey",
      inputSchema: {
        type: "object",
        required: ["subject", "scores"],
        additionalProperties: false,
        $defs: {
          subject: {
            type: "object",
            required: ["name", "active"],
            additionalProperties: false,
            properties: { name: { type: "string" }, active: { type: "boolean" } },
          },
        },
        properties: {
          subject: { $ref: "#/$defs/subject" },
          scores: { type: "array", items: { type: "number" } },
          mode: { type: "string", enum: ["brief", "full"] },
          durationMs: { type: "integer", minimum: 1, maximum: 60000 },
        },
      },
    },
  ];
  return {
    types: types.map((type) => ({
      ...type,
      configuration: { type: type.type, inputSchema: type.inputSchema, capacity: 1 },
    })),
    async close() {},
  };
}
export async function fixtureBundles(
  directory: string,
  types = fixtureTypes().types,
  gateFile?: string,
) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true });
  const bundles: Record<string, BundleReference> = {};
  const ipfsClient = new MemoryIpfsClient();
  for (const type of types) {
    const source = join(root, type.type);
    await mkdir(source);
    const declaration = join(source, "task.yaml"),
      callback = join(source, "callback.ts");
    await writeFile(
      declaration,
      JSON.stringify({
        $schema: taskSchemaUri,
        name: type.type,
        runtime: { type: "node", minVersion: "22.13.0" },
        entry: "worker.cjs",
        inputSchema: type.inputSchema,
        resultSchema: type.resultSchema,
        messageSchema: type.messageSchema,
      }),
    );
    await writeFile(
      callback,
      `import {${type.exportName} as factory} from ${JSON.stringify(fileURLToPath(type.module))};
import {existsSync} from "node:fs";
const type=factory(${JSON.stringify(type.configuration)}, {async invoke(context,action){
if(action!=="smoke-gate")throw new Error("Unknown fixture action.");
while(!existsSync(${JSON.stringify(gateFile ?? join(root, "unused-gate"))})){
context.signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,5));}
return null;
}});
export default (input,context)=>type.run(input,context);`,
    );
    const built = await buildTaskBundle({
      declaration,
      entry: callback,
      outDirectory: join(source, "bundle"),
    });
    bundles[type.type] = (await importTaskBundle(built.directory, ipfsClient)).cid;
  }
  return {
    types,
    ipfsClient,
    bundles,
    parameters(value: Record<string, unknown>): Parameters {
      if (value.bundle) return value as Parameters;
      const { type, ...parameters } = value;
      const bundle = bundles[String(type)];
      if (!bundle) throw new Error("Unknown authored fixture Bundle.");
      return { ...parameters, bundle };
    },
    async close() {},
  };
}
export async function submitFixture(
  engine: TaskService,
  parameters: Record<string, unknown>,
  caller: Caller,
  resources: Awaited<ReturnType<typeof fixtureBundles>>,
) {
  const request = {
    ...resources.parameters(parameters),
    requestId: parameters.requestId ?? newId(),
  };
  let result = await engine.submit(request, caller);
  while (result.status === "preparing")
    result = await engine.getRequestStatus(String(request.requestId), { waitMs: 1000 }, caller);
  if (result.status === "rejected") throw new TaskError(result.error.code, result.error.message);
  return engine.getTask(result.taskId, caller);
}
