import assert from "node:assert/strict";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

const [mode, log] = process.argv.slice(2);
assert.ok(["fix", "wrong", "summary-only"].includes(mode));
let cwd;
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.id === undefined) continue;
  let result;
  if (message.method === "initialize") {
    assert.equal(message.params.protocolVersion, 1);
    result = { protocolVersion: 1 };
  } else if (message.method === "session/new") {
    cwd = message.params.cwd;
    result = { sessionId: "self-check-fixture" };
  } else if (message.method === "session/prompt") {
    assert.ok(cwd);
    const text = message.params.prompt.map(({ text }) => text ?? "").join("\n");
    const taskLine = text.split("\n").find((line) => line.startsWith("Self-check task: "));
    assert.ok(taskLine);
    const task = JSON.parse(taskLine.slice("Self-check task: ".length));
    assert.equal(task.marker, "marker.txt");
    assert.equal(typeof task.expected, "string");
    // Safe count only: no nonce, prompt, model output, or environment is persisted.
    await appendFile(log, `${JSON.stringify({ method: "session/prompt", mode })}\n`);
    if (mode !== "summary-only") {
      await writeFile(join(cwd, task.marker), mode === "fix" ? task.expected : "wrong");
    }
    result = { stopReason: "end_turn", summary: "Fixture reports success" };
  } else {
    console.log(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Unknown method" },
      }),
    );
    continue;
  }
  console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
}
