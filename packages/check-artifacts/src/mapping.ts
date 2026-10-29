import { finiteJson, jsonObject, type Json, type JsonObject } from "./contracts.js";

/**
 * Portable JSONata selection profile: $, required object paths, JSON literals,
 * object constructors and array constructors. No functions, transforms or IO.
 * Missing paths are errors (never host-language undefined). Array constructors
 * append selected sequences but preserve explicitly nested array constructors.
 */
function evaluateMapping(
  expression: string,
  subject: JsonObject,
  validateOnly: boolean,
): JsonObject {
  if (
    !finiteJson(subject) ||
    Buffer.byteLength(JSON.stringify(subject), "utf8") > 1024 * 1024 ||
    expression.length > 4096
  )
    throw new Error("Mapping exceeds bounds.");
  const tokens: string[] = [];
  const lexer =
    /\s*("(?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[$.[\]{},:])/y;
  let offset = 0;
  while (offset < expression.trimEnd().length) {
    lexer.lastIndex = offset;
    const match = lexer.exec(expression);
    if (!match?.[1] || tokens.length >= 256)
      throw new Error("Unsupported JSONata profile expression.");
    tokens.push(match[1]);
    offset = lexer.lastIndex;
  }
  let cursor = 0;
  function take(expected: string) {
    if (tokens[cursor++] !== expected) throw new Error("Invalid JSONata profile syntax.");
  }
  function value(depth: number): Json {
    if (depth > 16) throw new Error("Mapping nesting exceeds bounds.");
    const token = tokens[cursor++];
    if (!token) throw new Error("Incomplete mapping.");
    if (token === "{") {
      const object: JsonObject = {};
      if (tokens[cursor] === "}") {
        cursor++;
        return object;
      }
      do {
        const key = tokens[cursor++];
        if (!key?.startsWith('"')) throw new Error("Object keys require JSON strings.");
        const name = JSON.parse(key) as string;
        if (Object.hasOwn(object, name)) throw new Error("Duplicate mapping key.");
        take(":");
        Object.defineProperty(object, name, {
          value: value(depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
        if (tokens[cursor] !== ",") break;
        cursor++;
      } while (cursor < tokens.length);
      take("}");
      return object;
    }
    if (token === "[") {
      const array: Json[] = [];
      if (tokens[cursor] === "]") {
        cursor++;
        return array;
      }
      do {
        const explicitArray = tokens[cursor] === "[";
        const item = value(depth + 1);
        if (Array.isArray(item) && !explicitArray) array.push(...item);
        else array.push(item);
        if (tokens[cursor] !== ",") break;
        cursor++;
      } while (cursor < tokens.length);
      take("]");
      return array;
    }
    if (token.startsWith('"') || /^-?\d/.test(token) || ["true", "false", "null"].includes(token))
      return JSON.parse(token) as Json;
    let selected: Json = subject;
    function property(key: string) {
      if (validateOnly && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        selected = {};
        return;
      }
      if (
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
        !jsonObject(selected) ||
        !Object.hasOwn(selected, key)
      )
        throw new Error("Mapping requires an existing object path.");
      selected = selected[key] ?? null;
    }
    if (token !== "$") property(token);
    while (tokens[cursor] === ".") {
      cursor++;
      property(tokens[cursor++] ?? "");
    }
    return structuredClone(selected);
  }
  const result = value(0);
  if (
    cursor !== tokens.length ||
    !jsonObject(result) ||
    Buffer.byteLength(JSON.stringify(result), "utf8") > 1024 * 1024
  )
    throw new Error("Mapping must yield a bounded JSON object.");
  return result;
}
export function mapSubject(expression: string, subject: JsonObject): JsonObject {
  return evaluateMapping(expression, subject, false);
}
export function validateSubjectMapping(expression: string): void {
  evaluateMapping(expression, {}, true);
}
