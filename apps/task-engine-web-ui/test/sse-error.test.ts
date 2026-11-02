import assert from "node:assert/strict";
import test from "node:test";
import { serializeSseFrame } from "../src/server.js";

test("SSE error controls redact decoded credentials and cannot advance the source anchor", () => {
  const token = "fixture-secret";
  const escaped = [...token]
    .map((letter) => `\\u${letter.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .join("");
  const frame = serializeSseFrame(
    `id: domain:999\nevent: task.error\ndata: {"error":{"message":"${token} ${escaped}","${escaped}":["${token}"]}}`,
    token,
  );
  assert.equal(/^id:/m.test(frame), false);
  assert.equal(frame.includes(token), false);
  assert.equal(frame.includes(escaped), false);
  const payload = JSON.parse(
    frame
      .split("\n")
      .find((line) => line.startsWith("data:"))!
      .slice(5),
  );
  assert.deepEqual(payload, {
    error: { message: "[redacted] [redacted]", "[redacted]": ["[redacted]"] },
  });
});

test("ordinary source envelopes retain their exact members and malformed error JSON fails explicitly", () => {
  const frame =
    'id: domain:1\nevent: task.collection\ndata: {"revision":"domain:1","changes":[{"id":"a"},{"id":"b"}],"message":"fixture-secret"}';
  assert.equal(serializeSseFrame(frame, "fixture-secret"), `${frame}\n\n`);
  assert.throws(() => serializeSseFrame("event: task.error\ndata: {", "fixture-secret"), {
    code: "invalid_stream",
  });
});
