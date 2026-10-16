#!/usr/bin/env node
let source = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  source += chunk;
});
process.stdin.on("end", () => {
  const subject = JSON.parse(source);
  const ready = require("node:fs").existsSync(subject.marker);
  process.stdout.write(
    JSON.stringify({
      status: 200,
      payload: ready
        ? { ok: true, problems: [] }
        : { ok: false, problems: [{ id: "not-ready", parameters: {} }] },
      message: "Deployment fixture completed.",
    }),
  );
});
