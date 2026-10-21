import assert from "node:assert/strict";
import { test } from "node:test";
import { CliError, formatCliError } from "../src/index.js";
import { markdownCodeBlock, markdownInlineCode, markdownText } from "../src/output.js";

test("human text remains one Markdown-safe line without terminal formatting", () => {
  assert.equal(
    markdownText("\u001b[31mAudit **label** | <script>\u001b[0m\nsecond line"),
    "Audit \\*\\*label\\*\\* \\| \\<script\\> second line",
  );
  assert.equal(markdownText("中文\r\n说明"), "中文 说明");
  assert.equal(markdownText("name_1 [value] # title"), "name\\_1 \\[value\\] \\# title");
});

test("inline code preserves paths and cannot be closed by embedded backticks", () => {
  assert.equal(markdownInlineCode("C:\\project\\objective.yaml"), "`C:\\project\\objective.yaml`");
  assert.equal(markdownInlineCode("name`with``ticks"), "```name`with``ticks```");
  assert.equal(markdownInlineCode("`quoted`"), "`` `quoted` ``");
  assert.equal(markdownInlineCode(" first line\nsecond line "), "`  first line second line  `");
  assert.equal(markdownInlineCode(""), '""');
});

test("code blocks preserve multiline configuration and fence embedded Markdown", () => {
  assert.equal(
    markdownCodeBlock('{\r\n  "ok": true\r\n}\r\n', "json"),
    '```json\n{\n  "ok": true\n}\n```',
  );
  assert.equal(
    markdownCodeBlock("literal\n```text\nvalue", "text"),
    "````text\nliteral\n```text\nvalue\n````",
  );
  assert.equal(markdownCodeBlock("\u001b[32mready\u001b[0m"), "```text\nready\n```");
});

test("human input details do not replace the error's machine message or status", () => {
  const error = new CliError(
    "Original machine error.",
    2,
    "pilot-error",
    undefined,
    "Input field `name` is required.\n\nNext: provide a subject matching subjectSchema.",
  );
  assert.equal(
    formatCliError(error),
    "Error: Input field `name` is required.\n\nNext: provide a subject matching subjectSchema.",
  );
  assert.equal(error.message, "Original machine error.");
  assert.equal(error.status, "pilot-error");
  assert.equal(error.exitCode, 2);
  assert.equal(formatCliError(new CliError("Missing input.")), "Error: Missing input.");
});

test("error guidance cannot close its JSON code block", () => {
  const error = new CliError("Missing subject.", 2, "invalid", {
    instructions: "Example ```text must remain data.",
  });
  const output = formatCliError(error);
  assert.match(output, /^Error: Missing subject\./);
  assert.match(output, /\n````json\n/);
  assert.match(output, /\n````$/);
});
