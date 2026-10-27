const { access, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
let calls = 0;
const pause = () => new Promise((done) => setTimeout(done, 20));
exports.execute = async (subject, context) => {
  const count = ++calls;
  if (subject.fail) throw new Error("manual injected failure");
  if (subject.hold) {
    context.defer(async () => {
      await writeFile(join(subject.controls, "cleaning"), "entered");
      for (;;) {
        try {
          await access(join(subject.controls, "release"));
          break;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await pause();
        }
      }
      await writeFile(join(subject.controls, "cleaned"), "done");
    });
    context.progress({ entered: true, marker: subject.marker, calls: count });
    await new Promise((done) => {
      if (context.signal.aborted) return done();
      context.signal.addEventListener("abort", done, { once: true });
    });
  }
  return { marker: subject.marker, calls: count };
};
