#!/usr/bin/env node
let source = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  source += chunk;
});
process.stdin.on("end", () => {
  const request = JSON.parse(source);
  const ready = require("node:fs").existsSync(request.subject.marker);
  process.stdout.write(
    JSON.stringify(
      ready ? { pass: true } : { pass: false, problems: [{ id: "not-ready", parameters: {} }] },
    ),
  );
});
