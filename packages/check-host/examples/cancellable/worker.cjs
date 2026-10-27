const fs = require("node:fs/promises");
const path = require("node:path");

let calls = 0;
exports.execute = async (subject, context) => {
  const count = ++calls;
  if (subject.fail) throw new Error("manual injected failure");
  if (subject.hold) {
    context.defer(async () => {
      await fs.writeFile(path.join(subject.controls, "cleaning"), "entered");
      for (;;) {
        try {
          await fs.access(path.join(subject.controls, "release"));
          break;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      await fs.writeFile(path.join(subject.controls, "cleaned"), "done");
    });
    context.progress({ entered: true, marker: subject.marker, calls: count });
    await new Promise((resolve) => {
      if (context.signal.aborted) resolve();
      else context.signal.addEventListener("abort", resolve, { once: true });
    });
  }
  return { marker: subject.marker, calls: count };
};
