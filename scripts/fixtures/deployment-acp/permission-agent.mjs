import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const pending = new Map();
let nextRequest = 1000;
const reply = (id, result) => console.log(JSON.stringify({ jsonrpc: "2.0", id, result }));
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.method === undefined) {
    const action = pending.get(message.id);
    if (action === undefined) continue;
    pending.delete(message.id);
    const permitted =
      message.result?.outcome?.outcome === "selected" &&
      message.result.outcome.optionId === "allow-once";
    if (permitted) await writeFile(action.marker, "permission-verified");
    reply(action.promptId, {
      stopReason: "end_turn",
      summary: permitted ? "Authorized marker written." : "Required edit was not authorized.",
    });
    continue;
  }
  if (message.id === undefined) continue;
  if (message.method === "initialize") {
    if (message.params.protocolVersion !== 1) throw new Error("ACP version must be numeric.");
    reply(message.id, { protocolVersion: 1, agentCapabilities: { loadSession: true } });
  } else if (message.method === "session/new") {
    reply(message.id, { sessionId: "permission-fixture" });
  } else if (message.method === "session/load") {
    reply(message.id, {});
  } else if (message.method === "session/prompt") {
    const text = message.params.prompt[0].text;
    const subjectLine = text.split("\n").find((line) => line.startsWith("Subject: "));
    if (subjectLine === undefined) throw new Error("Expected subject in regulation prompt.");
    const subject = JSON.parse(subjectLine.slice("Subject: ".length));
    const diffPath = subject.marker.replaceAll("\\", "/");
    const id = nextRequest++;
    pending.set(id, { promptId: message.id, marker: subject.marker });
    console.log(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "session/request_permission",
        params: {
          sessionId: message.params.sessionId,
          toolCall: {
            toolCallId: `write-${id}`,
            title: "Write verification marker",
            kind: "edit",
            locations: [{ path: subject.marker }],
            rawInput: {
              fileName: subject.marker,
              diff: `\ndiff --git a/${diffPath} b/${diffPath}\ncreate file mode 100644\n--- a/dev/null\n+++ b/${diffPath}\n@@ -1,0 +1 @@\n+permission-verified\n`,
            },
          },
          options: [
            { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
            { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
          ],
        },
      }),
    );
  } else {
    reply(message.id, {});
  }
}
