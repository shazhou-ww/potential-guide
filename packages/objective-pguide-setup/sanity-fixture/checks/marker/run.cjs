#!/usr/bin/env node
const { lstatSync, readFileSync } = require("node:fs");
let source = "";
process.stdin.on("data", (chunk) => {
  source += chunk;
});
process.stdin.on("end", () => {
  const { marker, expected } = JSON.parse(source);
  let ok = false;
  try {
    const details = lstatSync(marker);
    ok =
      details.isFile() &&
      details.size === expected.length &&
      readFileSync(marker, "utf8") === expected;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  console.log(
    JSON.stringify({
      status: 200,
      message: "",
      payload: ok
        ? { ok: true, problems: [] }
        : {
            ok: false,
            problems: [
              {
                kind: "internal",
                id: "marker-incorrect",
                parameters: {
                  marker,
                  expected,
                  instruction:
                    "Write exactly expected into marker (no newline). Do not modify other files.",
                },
              },
            ],
          },
    }),
  );
});
