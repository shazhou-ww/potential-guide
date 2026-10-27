import { type CheckPath, type LoadedTree, paths, type State } from "./model.js";

const status = "Not run — documentation only; bindings and test results are not validated.";
function limitation(path: CheckPath): string {
  return path.states
    .filter((state) => state.platforms)
    .map((state) => `${state.id}: only ${state.platforms?.join(", ")} (other platforms: skipped)`)
    .join("; ");
}
export function renderTerminal({ tree }: LoadedTree): string {
  const lines = [`${tree.namespace} — ${status}`];
  const visit = (state: State, indent: string) => {
    lines.push(
      `${indent}state ${state.id}: ${state.title}${state.platforms ? ` [${state.platforms.join(", ")} only]` : ""}`,
    );
    lines.push(`${indent}  transition_${state.id} → after`);
    for (const check of state.checks)
      lines.push(`${indent}  check ${state.id}.${check.id}: ${check.title}`);
    for (const child of state.states) visit(child, `${indent}  `);
  };
  visit(tree.state, "");
  return `${lines.join("\n").trimEnd()}\n`;
}
export function renderMarkdown(loaded: LoadedTree): string {
  const { tree } = loaded;
  const lines = [
    `# ${tree.namespace}`,
    "",
    status,
    "",
    "Generated from YAML. Commands are text, never executed by the renderer.",
    "",
  ];
  for (const path of paths(tree)) {
    lines.push(`<a id="${path.id}"></a>`, `## ${path.id}: ${path.check.title}`, "");
    if (limitation(path)) lines.push(limitation(path), "");
    lines.push("### Enter (root → state)", "");
    for (const state of path.states)
      lines.push(`#### transition_${state.id}: ${state.title}`, "", state.before, "");
    lines.push(`### Check ${path.id}`, "", path.check.doc, "", "### Cleanup (reverse order)", "");
    for (const state of [...path.states].reverse())
      lines.push(`#### after ${state.id}`, "", state.after, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
// Descriptions stay literal, including Markdown command fences: no raw HTML, scripts or links.
function prose(value: string): string {
  return `<pre>${escapeHtml(value)}</pre>`;
}
export function renderHtml(loaded: LoadedTree): string {
  const { tree } = loaded;
  const navigation = (state: State): string =>
    `<details open id="state-${state.id}"><summary>${escapeHtml(state.id)}: ${escapeHtml(state.title)}</summary><ul>${state.checks.map((c) => `<li><a href="#${state.id}.${c.id}">${escapeHtml(c.title)}</a></li>`).join("")}</ul>${state.states.map(navigation).join("")}</details>`;
  const articles = paths(tree)
    .map(
      (path) =>
        `<article id="${path.id}"><h2>${escapeHtml(path.id)}: ${escapeHtml(path.check.title)}</h2><p>${escapeHtml(limitation(path))}</p><h3>Enter (root → state)</h3>${path.states.map((s) => `<h4>transition_${s.id}: ${escapeHtml(s.title)}</h4>${prose(s.before)}`).join("")}<h3>Check ${path.id}</h3>${prose(path.check.doc)}<h3>Cleanup (reverse order)</h3>${[
          ...path.states,
        ]
          .reverse()
          .map((s) => `<h4>after ${s.id}</h4>${prose(s.after)}`)
          .join("")}</article>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(tree.namespace)}</title><style>body{font:16px system-ui;max-width:72rem;margin:auto;padding:2rem}details{margin-left:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eee;color:#111;padding:1rem;user-select:text}article{border-top:1px solid #888;margin-top:2rem}a{color:#246}</style></head>
<body><h1>${escapeHtml(tree.namespace)}</h1><p>${escapeHtml(status)}</p><p>Commands are selectable text. This offline page never executes them. Copy into a terminal only after reviewing ownership and cleanup.</p><nav aria-label="State tree">${navigation(tree.state)}</nav>${articles}</body></html>\n`;
}
