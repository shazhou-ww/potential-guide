import { stripVTControlCharacters } from "node:util";

function singleLine(value: string): string {
  return stripVTControlCharacters(value).replace(/[\r\n\u2028\u2029]+/gu, " ");
}

function fence(value: string, minimum: number): string {
  let length = minimum;
  for (const match of value.matchAll(/`+/gu)) length = Math.max(length, match[0].length + 1);
  return "`".repeat(length);
}

export function markdownText(value: string): string {
  return singleLine(value).replace(/[\\`*_[\]{}<>#!|~]/gu, "\\$&");
}

export function markdownInlineCode(value: string): string {
  const text = singleLine(value);
  if (text === "") return '""';
  const delimiter = fence(text, 1);
  const padding = /^[` ]|[` ]$/u.test(text) ? " " : "";
  return `${delimiter}${padding}${text}${padding}${delimiter}`;
}

export function markdownCodeBlock(
  value: string,
  language: "json" | "yaml" | "text" = "text",
): string {
  const text = stripVTControlCharacters(value).replace(/\r\n?/gu, "\n").replace(/\n$/u, "");
  const delimiter = fence(text, 3);
  return `${delimiter}${language}\n${text}\n${delimiter}`;
}
