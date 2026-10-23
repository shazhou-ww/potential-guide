import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Fault, keys, own, problemIds, record, validSample } from "./contract.mjs";
import { execute } from "./execution.mjs";
export const bootstrap =
  "let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>2097152)throw Error('transport-input-limit');}const {source,stage,subject}=JSON.parse(text);const m=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));console.log(JSON.stringify(stage==='sample'?await m.sample(subject):await m.check(stage,subject)));";
export async function remote(stage, subject, options = {}) {
  const source = await readFile(
    fileURLToPath(new URL("../runtime/health-check.mjs", import.meta.url)),
    "utf8",
  );
  const result = await execute(
    "docker",
    [
      "exec",
      "-i",
      "--user",
      subject.user,
      subject.target.container,
      "node",
      "--input-type=module",
      "-e",
      bootstrap,
    ],
    {
      input: JSON.stringify({ source, stage, subject: { ...subject, target: { type: "local" } } }),
      deadline: Date.now() + 27000,
      timeout: 27000,
      signal: options.signal,
    },
  );
  if (result.code !== 0)
    throw new Fault(
      `docker-transport: ${result.missing ? "docker missing" : `exit ${result.code}`}: ${result.stderr.slice(0, 2048)}`,
    );
  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Fault("docker-transport: response is not a single JSON envelope.");
  }
  if (
    !keys(output, ["status", "payload", "message"]) ||
    !own(output, ["status", "payload", "message"]) ||
    !Number.isInteger(output.status) ||
    output.status < 100 ||
    output.status > 599 ||
    typeof output.message !== "string"
  )
    throw new Fault("docker-transport: invalid envelope.");
  if (output.status !== 200) {
    if (output.payload !== null || !output.message.trim())
      throw new Fault("docker-transport: invalid fault envelope.");
  } else if (stage === "sample") {
    if (!validSample(output.payload)) throw new Fault("docker-transport: invalid sample.");
  } else if (
    !keys(output.payload, ["ok", "problems"]) ||
    !own(output.payload, ["ok", "problems"]) ||
    typeof output.payload.ok !== "boolean" ||
    !Array.isArray(output.payload.problems) ||
    output.payload.ok !== (output.payload.problems.length === 0) ||
    !output.payload.problems.every(
      (p) =>
        keys(p, ["kind", "id", "parameters"]) &&
        own(p, ["kind", "id", "parameters"]) &&
        p.kind === "internal" &&
        problemIds[stage].includes(p.id) &&
        record(p.parameters),
    )
  )
    throw new Fault("docker-transport: invalid check result.");
  return output;
}
