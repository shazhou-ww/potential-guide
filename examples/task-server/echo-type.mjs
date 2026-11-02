export default async function echo(input, context) {
  context.signal.throwIfAborted();
  await context.progress({ stage: "execution", message: "返回输入副本。" });
  return input;
}
