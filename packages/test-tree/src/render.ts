import type { Instructions, LoadedTree, State } from "./model.js";

const status = "Not run — 操作说明，未执行验证。";
interface StatePath {
  state: State;
  ancestors: State[];
}
function states(root: State): StatePath[] {
  const result: StatePath[] = [];
  const visit = (state: State, ancestors: State[]) => {
    result.push({ state, ancestors });
    for (const child of state.states) visit(child, [...ancestors, state]);
  };
  visit(root, []);
  return result;
}
function limitation(path: State[]): string {
  return path
    .filter((state) => state.platforms)
    .map((state) => `${state.title}：仅适用于 ${state.platforms?.join(", ")}`)
    .join("；");
}
const environments = [
  ["posix", "Linux / macOS shell"],
  ["powershell", "Windows PowerShell"],
] as const;
function markdownInstructions(value: Instructions): string {
  if (typeof value === "string") return value;
  return environments
    .map(
      ([key, title]) =>
        `<details>\n<summary>${title}</summary>\n\n${value[key].trim()}\n\n</details>`,
    )
    .join("\n\n");
}
export function renderTerminal({ tree }: LoadedTree): string {
  const lines = [`${tree.namespace} — ${status}`];
  const visit = (state: State, indent: string) => {
    lines.push(
      `${indent}状态 ${state.id}: ${state.title}${state.platforms ? ` [${state.platforms.join(", ")}]` : ""}`,
    );
    for (const check of state.checks)
      lines.push(`${indent}  观察 ${state.id}.${check.id}：${check.title}`);
    for (const child of state.states) visit(child, `${indent}  `);
  };
  visit(tree.state, "");
  return `${lines.join("\n")}\n`;
}
export function renderMarkdown({ tree }: LoadedTree): string {
  const lines = [
    `# ${tree.namespace} 状态操作手册`,
    "",
    status,
    "",
    "从初始状态开始，沿状态树执行进入操作并核对观察结果。不同分支从独立环境开始。",
    "命令由人执行；本页面不会运行命令。资源退出说明只用于结束操作，不是逆向状态转移。",
    "",
    "## 状态树",
    "",
  ];
  for (const { state, ancestors } of states(tree.state))
    lines.push(`${"  ".repeat(ancestors.length)}- [${state.title}](#state-${state.id})`);
  for (const { state, ancestors } of states(tree.state)) {
    lines.push(
      "",
      `<a id="state-${state.id}"></a>`,
      `## 状态：${state.title}`,
      "",
      `到达路径：${[...ancestors, state].map((s) => s.title).join(" → ")}`,
      "",
    );
    if (limitation([...ancestors, state])) lines.push(limitation([...ancestors, state]), "");
    lines.push("### 如何进入", "", markdownInstructions(state.before), "", "### 在此状态观察", "");
    if (!state.checks.length) lines.push("核对上面的准备结果，再选择下一状态。", "");
    for (const check of state.checks)
      lines.push(
        `<a id="${state.id}.${check.id}"></a>`,
        `#### ${check.title}`,
        "",
        markdownInstructions(check.doc),
        "",
      );
    lines.push("### 可以转向的状态", "");
    if (!state.states.length) lines.push("此分支已结束，可按下面的说明退出并释放资源。", "");
    for (const child of state.states) lines.push(`- [${child.title}](#state-${child.id})`);
    lines.push(
      "",
      "### 结束操作时",
      "",
      markdownInstructions(state.after),
      "",
      "完成本层资源收尾后，按到达路径向上处理各层拥有的资源；不要把退出当成业务回滚。",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
// Only fenced commands are formatted; all content is escaped, never evaluated as HTML.
function prose(value: Instructions): string {
  if (typeof value !== "string")
    return environments
      .map(
        ([key, title]) =>
          `<details class="platform" data-platform="${key}"><summary>${title}</summary>${prose(value[key])}</details>`,
      )
      .join("");
  return value
    .split(/(```[^\n]*\n[\s\S]*?```)/g)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith("```")) {
        const code = part.slice(part.indexOf("\n") + 1, -3).trimEnd();
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
      }
      return `<p class="prose">${escapeHtml(part.trim())}</p>`;
    })
    .join("");
}
export function renderHtml({ tree }: LoadedTree): string {
  const link = (state: State) => `<a href="#state-${state.id}">${escapeHtml(state.title)}</a>`;
  const navigation = (state: State): string =>
    `<details open id="nav-${state.id}"><summary>${link(state)}</summary>${state.states.map(navigation).join("")}</details>`;
  const articles = states(tree.state)
    .map(({ state, ancestors }) => {
      const path = [...ancestors, state];
      return `<article id="state-${state.id}"><h2>状态：${escapeHtml(state.title)}</h2>
<p>到达路径：${path.map(link).join(" → ")}</p><p>${escapeHtml(limitation(path))}</p>
<h3>如何进入</h3>${prose(state.before)}
<h3>在此状态观察</h3>${state.checks.length ? state.checks.map((c) => `<section id="${state.id}.${c.id}"><h4>${escapeHtml(c.title)}</h4>${prose(c.doc)}</section>`).join("") : "<p>核对上面的准备结果，再选择下一状态。</p>"}
<h3>可以转向的状态</h3>${state.states.length ? `<ul>${state.states.map((s) => `<li>${link(s)}</li>`).join("")}</ul>` : "<p>此分支已结束，可按下面的说明退出并释放资源。</p>"}
<details><summary>结束操作与资源释放</summary>${prose(state.after)}<p>本层收尾后，再处理上层拥有的资源：</p>${
        ancestors.length
          ? `<ol>${[...ancestors]
              .reverse()
              .map((s) => `<li>${link(s)} — 查看其“结束操作与资源释放”</li>`)
              .join("")}</ol>`
          : "<p>没有上层状态。</p>"
      }</details></article>`;
    })
    .join("");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(tree.namespace)}</title><style>body{font:16px system-ui;max-width:90rem;margin:auto;padding:2rem;color:#222}header{margin-bottom:2rem}.layout{display:grid;grid-template-columns:20rem minmax(0,1fr);gap:2rem}nav{position:sticky;top:1rem;align-self:start;max-height:90vh;overflow:auto}details{margin:.5rem 0 .5rem 1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eee;color:#111;padding:1rem;user-select:text}.prose{white-space:pre-wrap;overflow-wrap:anywhere}article{border-top:1px solid #888;padding-top:1rem;margin-bottom:3rem;scroll-margin-top:1rem}section{scroll-margin-top:1rem}a{color:#246}@media(max-width:850px){.layout{display:block}nav{position:static;max-height:none}}</style></head>
<body><header><h1>${escapeHtml(tree.namespace)} 状态操作手册</h1><p>${escapeHtml(status)}</p><p>从初始状态开始，沿状态树执行进入操作并核对观察结果。不同分支从独立环境开始。</p><p>命令由人执行；本页面不会运行命令。退出说明用于资源释放，不是逆向状态转移。</p></header><div class="layout"><nav aria-label="State tree"><h2>状态树</h2>${navigation(tree.state)}</nav><main>${articles}</main></div></body></html>\n`;
}
