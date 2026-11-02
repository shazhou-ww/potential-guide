import type { RunContext } from "@potential-guide/task-sdk";

export default async function echo(input: { text: string }, context: RunContext) {
  await context.progress({ stage: "execution", message: "Echoing the supplied text." });
  return { text: input.text };
}
