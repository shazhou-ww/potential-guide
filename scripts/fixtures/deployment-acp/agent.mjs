import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

const mode = process.env.PGUIDE_FIXTURE_MODE ?? "repair";

for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.id === undefined) continue;

  let result = {};
  if (message.method === "initialize") {
    result = { protocolVersion: "1", agentCapabilities: { loadSession: true } };
  } else if (message.method === "session/new") {
    result = { sessionId: "deployment-fixture-session" };
  } else if (message.method === "session/resume") {
    if (process.env.PGUIDE_RESUME_MARKER) {
      await writeFile(process.env.PGUIDE_RESUME_MARKER, "resumed");
    }
  } else if (message.method === "session/prompt") {
    if (process.env.PGUIDE_PROMPT_MARKER) {
      // Readiness must tolerate startup beyond the old two-second polling cutoff.
      await delay(2_100);
      await writeFile(process.env.PGUIDE_PROMPT_MARKER, "prompted");
    }
    if (mode === "hang") await new Promise(() => {});
    if (mode === "blocked") {
      result = { stopReason: "refusal", summary: "fixture blocked safely" };
    } else {
      if (mode === "repair" && process.env.PGUIDE_ACTION_MARKER) {
        await writeFile(process.env.PGUIDE_ACTION_MARKER, "ready");
      }
      const secret = process.env.PGUIDE_FIXTURE_SECRET ?? "";
      process.stderr.write(`fixture diagnostic ${secret}\n`);
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "deployment-fixture-session",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: `fixture ${secret}` },
            },
          },
        }),
      );
      result = { stopReason: "end_turn", summary: `fixture action ${secret}` };
    }
  }

  console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
}
