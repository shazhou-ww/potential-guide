import { assertFiniteJson } from "./json.js";

type Schema = boolean | Record<string, unknown>;
export const envelopeKeys = [
  "type",
  "timeoutMs",
  "eligibleAt",
  "seriesId",
  "matchPolicy",
  "recurrence",
];
export const envelopeSchema: Schema = {
  type: "object",
  required: ["timeoutMs"],
  additionalProperties: false,
  properties: {
    timeoutMs: { type: "integer", title: "超时预算 timeoutMs（毫秒）", minimum: 1 },
    eligibleAt: { type: "string", title: "资格时间 eligibleAt（带时区 ISO 时间）" },
    seriesId: { type: "string", title: "seriesId（可选原样保留）" },
    matchPolicy: {
      type: "string",
      enum: ["started-after-eligible", "terminated-after-eligible"],
    },
    recurrence: {
      type: "object",
      required: ["periodMs", "anchor"],
      additionalProperties: false,
      properties: {
        periodMs: { type: "integer", minimum: 1 },
        anchor: { type: "string", enum: ["eligible", "terminated"] },
      },
    },
  },
};
export function resolvedSchema(schema: Schema, root: Schema, depth = 0): Schema {
  if (typeof schema === "boolean" || !schema.$ref) return schema;
  if (depth > 32 || typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/"))
    throw new Error("不支持的 Schema 引用；输入保持不变。");
  let result: unknown = root;
  for (const segment of schema.$ref.slice(2).split("/")) {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!result || typeof result !== "object" || !Object.hasOwn(result, key))
      throw new Error("Schema 本地引用不存在。");
    result = (result as Record<string, unknown>)[key];
  }
  const target = resolvedSchema(result as Schema, root, depth + 1);
  const { $ref: _ref, ...siblings } = schema;
  if (typeof target === "boolean") return target ? siblings : false;
  const annotations = new Set([
    "title",
    "description",
    "$comment",
    "$defs",
    "$schema",
    "default",
    "examples",
    "deprecated",
    "readOnly",
    "writeOnly",
  ]);
  if (Object.keys(siblings).some((key) => !annotations.has(key)))
    return { ...siblings, allOf: [target, siblings] };
  return { ...target, ...siblings };
}
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}
interface Editor {
  node: HTMLElement;
  read(): unknown;
}
let fieldId = 0;
function button(text: string, action: () => void): HTMLButtonElement {
  const result = element("button", text);
  result.type = "button";
  result.addEventListener("click", action);
  return result;
}
export function schemaEditor(
  raw: Schema,
  initial: unknown,
  root: Schema = raw,
  name = "输入",
  depth = 0,
): Editor {
  if (depth > 32) throw new Error("表单嵌套超过 32 层。");
  const schema = resolvedSchema(raw, root);
  const box = element("fieldset");
  const title =
    typeof schema === "object" && typeof schema.title === "string" ? schema.title : name;
  box.append(element("legend", title));
  if (typeof schema === "object" && typeof schema.description === "string")
    box.append(element("p", schema.description));
  if (schema === false) {
    box.append(element("p", "此 Schema 不允许任何值。"));
    return {
      node: box,
      read: () => {
        throw new Error(`${name} 不允许输入。`);
      },
    };
  }
  const spec = schema === true ? {} : schema;
  const types = Array.isArray(spec.type) ? spec.type : [spec.type];
  const complex = ["oneOf", "anyOf", "allOf", "if", "patternProperties", "dependentSchemas"].some(
    (key) => key in spec,
  );
  const localJson = (): Editor => {
    const input = element("textarea");
    input.id = `field-${++fieldId}`;
    input.rows = 5;
    input.value = initial === undefined ? "" : JSON.stringify(initial, null, 2);
    const label = element("label", `${name} · 局部 JSON 值（不转换、不补默认值）`);
    label.htmlFor = input.id;
    const details = element("details");
    details.append(
      element("summary", "查看输入约束"),
      element("pre", JSON.stringify(spec, null, 2)),
    );
    box.append(label, input, details);
    if (typeof raw === "object" && raw.$ref && "allOf" in spec)
      box.append(
        element("p", "$ref 与同级约束联合生效；使用局部 JSON 保留完整约束，不覆盖引用字段。"),
      );
    return {
      node: box,
      read() {
        try {
          const parsed = JSON.parse(input.value);
          assertFiniteJson(parsed);
          if (
            types.length === 1 &&
            types[0] === "object" &&
            (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          )
            throw new Error();
          return parsed;
        } catch {
          throw new Error(`${name}：请输入有效${types[0] === "object" ? "对象" : ""} JSON。`);
        }
      },
    };
  };
  if (complex || types.length !== 1 || !types[0]) return localJson();
  if (!["object", "array"].includes(String(types[0])) || spec.enum || "const" in spec) {
    box.querySelector("legend")?.remove();
    box.className = "scalar-field";
  }
  if (spec.enum || "const" in spec) {
    const values = (spec.enum ?? [spec.const]) as unknown[];
    const select = element("select");
    select.id = `field-${++fieldId}`;
    const label = element("label", title);
    label.htmlFor = select.id;
    select.append(new Option("请选择（不会自动填值）", ""));
    values.forEach((value, index) => {
      select.append(new Option(JSON.stringify(value), String(index)));
    });
    if (initial !== undefined) {
      const index = values.findIndex((value) => JSON.stringify(value) === JSON.stringify(initial));
      if (index >= 0) select.value = String(index);
      else return localJson();
    }
    box.append(label, select);
    return {
      node: box,
      read() {
        if (select.value === "") throw new Error(`${name} 尚未选择。`);
        return structuredClone(values[Number(select.value)]);
      },
    };
  }
  if (types[0] === "object") {
    const properties = spec.properties as Record<string, Schema> | undefined;
    if (!properties || !Object.keys(properties).length) return localJson();
    if (
      initial !== undefined &&
      (!initial || Array.isArray(initial) || typeof initial !== "object")
    )
      return localJson();
    const original = (initial ?? {}) as Record<string, unknown>;
    const children: { key: string; editor: Editor; enabled: HTMLInputElement }[] = [];
    for (const [key, property] of Object.entries(properties)) {
      const required = Array.isArray(spec.required) && spec.required.includes(key);
      const enabled = element("input");
      enabled.type = "checkbox";
      enabled.checked = required || Object.hasOwn(original, key);
      enabled.disabled = required;
      const label = element("label", `${key}${required ? "（必填）" : "（包含此字段）"}`);
      label.prepend(enabled);
      const editor = schemaEditor(
        property,
        Object.hasOwn(original, key) ? original[key] : undefined,
        root,
        key,
        depth + 1,
      );
      (editor.node as HTMLFieldSetElement).disabled = !enabled.checked;
      editor.node.hidden = !enabled.checked;
      enabled.addEventListener("change", () => {
        (editor.node as HTMLFieldSetElement).disabled = !enabled.checked;
        editor.node.hidden = !enabled.checked;
      });
      if (required) {
        const marker = element("span", "必需字段");
        marker.className = "required-mark";
        const legend = editor.node.querySelector(":scope > legend");
        if (legend) legend.append(marker);
        else editor.node.prepend(marker);
      } else box.append(label);
      box.append(editor.node);
      children.push({ key, editor, enabled });
    }
    const extras = Object.fromEntries(
      Object.entries(original).filter(([key]) => !Object.hasOwn(properties, key)),
    );
    let extrasEditor: Editor | undefined;
    if (spec.additionalProperties !== false || Object.keys(extras).length) {
      extrasEditor = schemaEditor(
        { type: "object" },
        extras,
        root,
        "其他属性（局部对象）",
        depth + 1,
      );
      box.append(extrasEditor.node);
    }
    return {
      node: box,
      read() {
        const result = extrasEditor ? (extrasEditor.read() as Record<string, unknown>) : {};
        for (const child of children) {
          if (Object.hasOwn(result, child.key))
            throw new Error(`其他属性不能重复声明 ${child.key}。`);
          if (child.enabled.checked)
            Object.defineProperty(result, child.key, {
              value: child.editor.read(),
              enumerable: true,
              writable: true,
              configurable: true,
            });
        }
        return result;
      },
    };
  }
  if (types[0] === "array") {
    if (initial !== undefined && !Array.isArray(initial)) return localJson();
    const items = element("div");
    const rows: Editor[] = [];
    const append = (value?: unknown) => {
      const prefix = spec.prefixItems as Schema[] | undefined;
      const editor = schemaEditor(
        prefix?.[rows.length] ?? (spec.items as Schema) ?? true,
        value,
        root,
        `${name}[${rows.length}]`,
        depth + 1,
      );
      rows.push(editor);
      items.append(editor.node);
    };
    for (const value of (initial ?? []) as unknown[]) append(value);
    box.append(
      items,
      button("添加项", () => append()),
      button("移除末项", () => rows.pop()?.node.remove()),
    );
    return { node: box, read: () => rows.map((row) => row.read()) };
  }
  if (types[0] === "boolean" || types[0] === "null") {
    return schemaEditor(
      { ...spec, enum: types[0] === "null" ? [null] : [true, false] },
      initial,
      root,
      name,
      depth + 1,
    );
  }
  const input = element("input");
  input.id = `field-${++fieldId}`;
  input.type = "text";
  if (types[0] === "number" || types[0] === "integer") input.inputMode = "decimal";
  input.value =
    initial === undefined ? "" : typeof initial === "string" ? initial : String(initial);
  const label = element("label", title);
  label.htmlFor = input.id;
  if (initial !== undefined && typeof initial !== (types[0] === "integer" ? "number" : types[0]))
    return localJson();
  box.append(label, input);
  return {
    node: box,
    read() {
      if (types[0] === "string") return input.value;
      if (types[0] === "number" || types[0] === "integer") {
        if (!/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(input.value))
          throw new Error(`${name} 需要 JSON 数字。`);
        const number = Number(input.value);
        if (!Number.isFinite(number) || (types[0] === "integer" && !Number.isInteger(number)))
          throw new Error(`${name} 数字无效。`);
        return number;
      }
      throw new Error(`${name}：不支持的 Schema 类型 ${String(types[0])}。`);
    },
  };
}
