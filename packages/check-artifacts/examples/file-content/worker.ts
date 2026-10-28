import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { Ajv } from "ajv";

const validate = new Ajv().compile({
  type: "object",
  required: ["file"],
  additionalProperties: false,
  properties: { file: { type: "string", minLength: 1 } },
});
export async function execute(subject: { file: string }, context: { signal: AbortSignal }) {
  context.signal.throwIfAborted();
  if (!validate(subject) || !isAbsolute(subject.file))
    throw new Error("Expected an absolute target file path.");
  const expected = await readFile(new URL("./resources/expected.txt", import.meta.url), "utf8");
  let actual: string | undefined;
  try {
    actual = await readFile(subject.file, { encoding: "utf8", signal: context.signal });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const ok = actual === expected;
  return {
    status: 200,
    message: ok ? "File content matches." : "File content does not match.",
    payload: {
      ok,
      problems: ok
        ? []
        : [{ kind: "internal", id: "content-mismatch", parameters: { file: subject.file } }],
    },
  };
}
