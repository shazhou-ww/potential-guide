import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { newId } from "@potential-guide/task-engine";
import { MemoryStore } from "@potential-guide/task-engine/testing";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { TaskError } from "@potential-guide/task-protocol";
import { startUiServer } from "../src/server.js";
import { fixtureTypes } from "./types.js";

const [executable, directory, reserved = "9223"] = process.argv.slice(2);
if (!executable || !directory)
  throw new Error(
    "Usage: browser-smoke <browser executable> <new output directory> [reserved ports]",
  );
const output = resolve(directory),
  profile = resolve(output, ".profile");
await mkdir(dirname(output), { recursive: true });
await mkdir(output); // Refuse to overwrite any existing profile or evidence.
const forbidden = new Set(reserved.split(",").map(Number));
const safePort = (url: string) => {
  if (forbidden.has(Number(new URL(url).port)))
    throw new Error("Reserved user port; refusing connection.");
};
const resources = fixtureTypes(),
  token = randomBytes(32).toString("hex");
const env = `UI_SMOKE_${randomBytes(8).toString("hex")}`;
process.env[env] = token;
let backend: Awaited<ReturnType<typeof startTaskServer>> | undefined;
let ui: Awaited<ReturnType<typeof startUiServer>> | undefined;
let browser: ChildProcess | undefined;
let socket: WebSocket | undefined;
let launchError: Error | undefined;
const checks: Record<string, unknown> = {};
const exceptions: unknown[] = [];
let sequence = 0;
const pending = new Map<
  number,
  {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function call<T = Record<string, unknown>>(
  method: string,
  params: object = {},
  timeout = 15000,
): Promise<T> {
  const id = ++sequence;
  return new Promise<T>((accept, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, timeout);
    pending.set(id, { resolve: (value) => accept(value as T), reject, timer });
    socket!.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate<T = unknown>(expression: string): Promise<T> {
  const result = await call<{ result: { value: T }; exceptionDetails?: unknown }>(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
  );
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function wait(expression: string, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(`Boolean((${expression}))`)) return;
    await delay(50);
  }
  throw new Error(`UI condition timed out: ${expression}`);
}
async function screenshot(name: string) {
  const result = await call<{ data: string }>("Page.captureScreenshot", { format: "png" });
  await writeFile(resolve(output, name), Buffer.from(result.data, "base64"));
}
async function click(selector: string) {
  await wait(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    return !!element && !element.closest('[role=dialog]')?.getAnimations().some(animation=>animation.playState==='running');
  })()`);
  const point = await evaluate<{ x: number; y: number }>(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing click target');
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...point,
    button: "left",
    clickCount: 1,
  });
  await call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...point,
    button: "left",
    clickCount: 1,
  });
}
async function pressKey(key: string, windowsVirtualKeyCode: number, modifiers = 0) {
  for (const type of ["keyDown", "keyUp"])
    await call("Input.dispatchKeyEvent", {
      type,
      key,
      code: key,
      windowsVirtualKeyCode,
      modifiers,
      ...(key === "Enter" && type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}),
    });
}
async function closeOverlay() {
  await pressKey("Escape", 27);
  await wait("!document.querySelector('[role=dialog]')");
}
try {
  backend = await startTaskServer({
    port: 0,
    store: new MemoryStore(),
    ownStore: true,
    types: resources.types,
    currentVersions: { echo: "1", survey: "1" },
    authorize: (caller, _operation, scope) => caller.scope === scope,
    resolveCaller(request) {
      if (request.headers.get("authorization") !== `Bearer ${token}`)
        throw new TaskError("unauthenticated", "Fixture authentication required.");
      return { scope: "fixture", subject: "ui" };
    },
    closeResources: resources.close,
    http: { pollMs: 20 },
    limits: { pageSize: 10 },
  });
  safePort(backend.url);
  const external = backend.engine.submit(
    {
      requestId: newId(),
      type: "survey",
      timeoutMs: 10000,
      subject: { name: "外部客户端", active: true },
      scores: [1, 2],
      durationMs: 100,
    },
    { scope: "fixture", subject: "external-client" },
  );
  ui = await startUiServer({
    port: 0,
    favoritesFile: resolve(output, ".favorites.json"),
    endpoints: [
      {
        id: "owned",
        label: "独立 v0.6 验证",
        binding: "owned-v06",
        url: backend.url,
        bearerEnv: env,
      },
    ],
  });
  safePort(ui.url);
  browser = spawn(
    executable,
    [
      "--headless=new",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-breakpad",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  browser.on("error", (error) => {
    launchError = error;
  });
  let port = "";
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (browser.exitCode !== null) throw new Error("Owned browser exited during launch.");
    try {
      port = (await readFile(resolve(profile, "DevToolsActivePort"), "utf8"))
        .split("\n")[0]!
        .trim();
      break;
    } catch {
      await delay(100);
    }
  }
  if (!/^\d+$/.test(port)) throw new Error("Owned browser did not expose DevTools.");
  const origin = `http://127.0.0.1:${port}`;
  safePort(origin);
  const targets = (await (await fetch(`${origin}/json/list`)).json()) as {
    type: string;
    url: string;
    webSocketDebuggerUrl: string;
  }[];
  const target = targets.find((item) => item.type === "page" && item.url === "about:blank");
  assert.ok(target, "only use the blank page created in our new profile");
  assert.equal(new URL(target.webSocketDebuggerUrl).port, port);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
      error?: unknown;
      method?: string;
      params?: unknown;
    };
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params);
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (request) {
        clearTimeout(request.timer);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      }
    }
  });
  await new Promise<void>((accept, reject) => {
    socket!.addEventListener("open", () => accept(), { once: true });
    socket!.addEventListener("error", () => reject(new Error("Owned CDP connection failed")), {
      once: true,
    });
  });
  await call("Runtime.enable");
  await call("Page.enable");
  checks.browser = (await call<{ product: string }>("Browser.getVersion")).product;
  for (const asset of ["app.js", "style.css"])
    checks[`${asset}Sha256`] = createHash("sha256")
      .update(Buffer.from(await (await fetch(`${ui.url}/${asset}`)).arrayBuffer()))
      .digest("hex");
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `
    globalThis.smokeCsp = [];
    addEventListener('securitypolicyviolation', event => smokeCsp.push({
      directive: event.effectiveDirective, blocked: event.blockedURI
    }));
  `,
  });
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call("Page.navigate", { url: ui.url });
  await wait("document.querySelector('#directory tbody tr')");
  checks.tabs = await evaluate("document.querySelectorAll('[role=tab]').length");
  checks.visiblePanels = await evaluate(
    "document.querySelectorAll('main [role=tabpanel]:not([hidden])').length",
  );
  assert.equal(checks.tabs, 2);
  assert.equal(checks.visiblePanels, 1);
  checks.actualComponents =
    await evaluate(`['tabs','tabs-list','tabs-trigger','tabs-content','button','input','table','table-row'].every(
    slot=>document.querySelector('[data-slot="'+slot+'"]')
  )`);
  assert.equal(checks.actualComponents, true);
  checks.headerOneRow = await evaluate(`(() => {
    const centers=['.topbar h1','.topbar [role=tablist]','.endpoint-label','#bar-toggle'].map(selector=>{
      const rect=document.querySelector(selector).getBoundingClientRect();return rect.y+rect.height/2;
    });return Math.max(...centers)-Math.min(...centers)<1;
  })()`);
  assert.equal(checks.headerOneRow, true);
  await click("#tab-tasks");
  await pressKey("ArrowRight", 39);
  await wait("document.querySelector('#tab-executions').getAttribute('aria-selected')==='true'");
  await pressKey("ArrowLeft", 37);
  await wait("document.querySelector('#tab-tasks').getAttribute('aria-selected')==='true'");
  checks.keyboardTabs = true;
  checks.inlineGlyphs = await evaluate(`(() => {
    const buttons=[...document.querySelectorAll('#directory button[data-glyph-action]')];
    return buttons.length===3 && buttons.every(button=>{
      const rect=button.getBoundingClientRect();
      return button.querySelectorAll('svg').length===1 && button.querySelector('svg').getAttribute('aria-hidden')==='true'
        && button.querySelector('.sr-only') && getComputedStyle(button.querySelector('.sr-only')).width==='1px'
        && button.getAttribute('aria-label') && rect.width>=28 && rect.width<=36 && rect.height>=28;
    }) && document.querySelector('#directory tbody td:nth-child(2) button').textContent==='survey'
      && !document.querySelector('#directory tbody td:nth-child(2) button svg')
      && document.querySelector('#new-task').textContent.includes('新建任务');
  })()`);
  assert.equal(checks.inlineGlyphs, true);
  const hover = await evaluate<{ x: number; y: number }>(`(() => {
    const rect=document.querySelector('#directory [data-action="详情"]').getBoundingClientRect();
    return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  })()`);
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", ...hover });
  await wait("document.querySelector('[role=tooltip]')?.textContent==='查看详情'");
  checks.glyphHoverHint = true;
  await wait(
    "!document.querySelector('[data-slot=tooltip-content]').getAnimations().some(animation=>animation.playState==='running')",
  );
  await screenshot("glyph-tooltip.png");
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
  await delay(50);
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 700 });
  await wait("!document.querySelector('[role=tooltip]')");
  await evaluate("document.querySelector('#directory tbody td:nth-child(2) button').focus();true");
  await pressKey("Tab", 9);
  await wait("document.querySelector('[role=tooltip]')?.textContent==='查看详情'");
  checks.glyphKeyboardHint = await evaluate(`(() => {
    const button=document.activeElement, tip=document.getElementById(button.getAttribute('aria-describedby'));
    return button.dataset.action==='详情' && button.getAttribute('aria-label')==='查看详情'
      && tip?.getAttribute('role')==='tooltip';
  })()`);
  assert.equal(checks.glyphKeyboardHint, true);
  await pressKey("Escape", 27);
  await wait("!document.querySelector('[role=tooltip]')");
  await pressKey("Enter", 13);
  await wait("document.querySelector('#task-detail [data-key=task-snapshot]')");
  checks.glyphDetailAction = await evaluate(
    `JSON.parse(document.querySelector('#task-detail [data-key=task-snapshot] pre').textContent).taskId===${JSON.stringify(external.taskId)}`,
  );
  assert.equal(checks.glyphDetailAction, true);
  await closeOverlay();
  await click('#directory [data-action="编辑重做"]');
  await wait("document.querySelector('#create-title')?.textContent==='编辑参数并新建任务'");
  checks.glyphEditAction = await evaluate("document.querySelector('#type').value==='survey'");
  assert.equal(checks.glyphEditAction, true);
  await closeOverlay();
  await click("#new-task");
  await wait("document.querySelector('#create-dialog[data-state=open]')");
  await wait("document.querySelector('#discovery-status')?.textContent.includes('已发现 2')");
  checks.nonceStylesApplied = await evaluate(`(() => {
    const nonce=document.querySelector('meta[name=ui-style-nonce]').content;
    const styles=[...document.querySelectorAll('style')];
    return styles.length>0 && styles.every(style=>style.nonce===nonce && style.sheet.cssRules.length>0);
  })()`);
  await evaluate("document.querySelector('#create-dialog [data-close]').focus();true");
  await pressKey("Tab", 9);
  assert.equal(await evaluate("document.activeElement.id==='type'"), true);
  await pressKey("Tab", 9, 8);
  checks.dialogTabTrap = await evaluate(
    "document.activeElement.matches('#create-dialog [data-close]')",
  );
  assert.equal(checks.dialogTabTrap, true);
  assert.equal(checks.nonceStylesApplied, true);
  await evaluate(`(() => {
    const type=document.querySelector('#type'); type.value='echo'; type.dispatchEvent(new Event('change',{bubbles:true}));
    for (const [label,value] of [['消息','独立浏览器验证'],['超时预算 timeoutMs（毫秒）','10000']]) {
      const item=[...document.querySelectorAll('#form-fields label')].find(item=>item.htmlFor&&item.textContent===label);
      document.getElementById(item.htmlFor).value=value;
    }
    const toggle=[...document.querySelectorAll('#form-fields input[type=checkbox]')].find(item=>item.parentElement.textContent.includes('durationMs'));
    toggle.click(); const label=[...document.querySelectorAll('#form-fields label')].find(item=>item.htmlFor&&item.textContent==='durationMs');
    document.getElementById(label.htmlFor).value='2500';
    globalThis.smokeDraft=[...document.querySelectorAll('#form-fields input')].find(item=>item.value==='独立浏览器验证');
    return true;
  })()`);
  await click('#create-actions [data-action="加入多条草稿"]');
  await evaluate("smokeDraft.value='第二条草稿';true");
  await click('#create-actions [data-action="加入多条草稿"]');
  await click('#create-actions [data-action="查看任务栏"]');
  await wait("document.querySelectorAll('#batches .receipt').length===2");
  const queue = await evaluate<string[]>(
    "[...document.querySelectorAll('#batches .receipt')].map(row=>row.dataset.key)",
  );
  assert.equal(
    await evaluate("document.querySelector('#batches .receipt [data-action=\"上移\"]').disabled"),
    true,
  );
  assert.equal(
    await evaluate(
      "document.querySelector('#batches .receipt [data-action=\"下移\"]').querySelectorAll('svg').length",
    ),
    1,
  );
  await click('#batches .receipt [data-action="下移"]');
  await wait(
    `document.querySelector('#batches .receipt').dataset.key===${JSON.stringify(queue[1])}`,
  );
  checks.glyphQueueSort = await evaluate(
    `JSON.stringify([...document.querySelectorAll('#batches .receipt')].map(row=>row.dataset.key))===${JSON.stringify(JSON.stringify([...queue].reverse()))}`,
  );
  assert.equal(checks.glyphQueueSort, true);
  await screenshot("queue-glyphs.png");
  await closeOverlay();
  await click("#new-task");
  await evaluate("smokeDraft.value='独立浏览器验证';true");
  await screenshot("popup.png");
  await closeOverlay();
  await wait("document.activeElement.id==='new-task'");
  checks.focusReturned = await evaluate("document.activeElement.id==='new-task'");
  assert.equal(checks.focusReturned, true);
  await click("#tab-executions");
  await wait("document.querySelector('#execution-directory').textContent.includes('survey')");
  assert.equal(await evaluate("document.querySelector('#tasks').hidden"), true);
  await click("#tab-tasks");
  await click("#new-task");
  checks.draftRetained = await evaluate(
    "globalThis.smokeDraft.isConnected && globalThis.smokeDraft.value==='独立浏览器验证'",
  );
  assert.equal(checks.draftRetained, true);
  await click('#create-actions button[data-action="提交任务"]');
  await wait("document.querySelector('#task-detail [data-key=task-snapshot] summary')");
  const createdId = await evaluate<string>(
    "JSON.parse(document.querySelector('#task-detail [data-key=task-snapshot] pre').textContent).taskId",
  );
  await evaluate(`(() => {
    globalThis.smokeSummary=document.querySelector('#task-detail [data-key=task-snapshot] summary');
    globalThis.smokeEvents=document.querySelector('#task-detail [data-key=all-events]');
    smokeEvents.open=true; smokeSummary.focus();
    globalThis.smokeCount=smokeEvents.querySelector('summary').textContent;
  })()`);
  await delay(350);
  checks.sseFocusStable = await evaluate(
    "document.activeElement===smokeSummary && smokeSummary.isConnected",
  );
  checks.eventsStayExpanded = await evaluate(
    "smokeEvents.open && smokeEvents.querySelector('summary').textContent!==smokeCount",
  );
  assert.equal(checks.sseFocusStable, true);
  assert.equal(checks.eventsStayExpanded, true);
  await closeOverlay();
  await evaluate(
    `globalThis.smokeTaskLink=document.querySelector('#task-list [data-key=open-task]');smokeTaskLink.focus();true`,
  );
  await delay(200);
  checks.taskEntryFocusStable = await evaluate(
    "document.activeElement===smokeTaskLink && smokeTaskLink.isConnected",
  );
  assert.equal(
    checks.taskEntryFocusStable,
    true,
    await evaluate(
      "JSON.stringify({active:document.activeElement.outerHTML,retained:smokeTaskLink.isConnected})",
    ),
  );
  assert.equal(
    backend.engine.getTask(createdId, { scope: "fixture", subject: "ui" }).canceledAt,
    undefined,
  );
  checks.closingDoesNotCancel = true;
  await click('#task-list [data-key="open-task"]');
  await wait("document.querySelector('#task-detail')?.textContent.includes('观察已结束')");
  assert.equal(await evaluate("!!document.querySelector('#create-dialog')"), false);
  const stamp = await evaluate(
    "document.querySelector('#task-detail .observation-state').textContent",
  );
  await delay(1600);
  checks.observationStopped =
    stamp ===
    (await evaluate("document.querySelector('#task-detail .observation-state').textContent"));
  assert.equal(checks.observationStopped, true);
  await screenshot("task-sheet.png");
  await closeOverlay();
  await click("#history-actions button");
  await wait("document.querySelectorAll('#directory tbody tr').length===2");
  await click("#directory .star");
  await wait("document.querySelector('#directory .star').getAttribute('aria-pressed')==='true'");
  await screenshot("tasks.png");
  for (let index = 0; index < 12; index++)
    backend.engine.submit(
      { requestId: newId(), type: "echo", timeoutMs: 10000, text: `目录 ${index}`, durationMs: 1 },
      { scope: "fixture", subject: "external-client" },
    );
  await click("#history-actions button");
  await wait("document.querySelectorAll('#directory tbody tr').length===10");
  await click('#directory button[data-action="目录下一页（原过滤条件）"]');
  await wait("document.querySelectorAll('#directory tbody tr').length===14");
  await evaluate(`(() => {
    document.querySelector('#history-type').value='保留未应用条件';
    const list=document.querySelector('#directory');list.scrollTop=100;
    globalThis.smokeList={width:list.getBoundingClientRect().width,scroll:list.scrollTop,html:list.textContent};
  })()`);
  checks.fullWidthList = await evaluate("smokeList.width>innerWidth*0.95 && smokeList.scroll>0");
  assert.equal(checks.fullWidthList, true);
  const row = "#directory tbody tr:nth-child(4) td:nth-child(2) button";
  await evaluate(`globalThis.smokeOpener=document.querySelector(${JSON.stringify(row)});true`);
  await click(row);
  await wait("document.querySelector('#task-detail [data-key=task-snapshot]')");
  await wait(
    "Math.abs(document.querySelector('#task-detail-sheet').getBoundingClientRect().right-innerWidth)<1",
  );
  checks.drawerGeometry = await evaluate(`(() => {
    const list=document.querySelector('#directory'), sheet=document.querySelector('#task-detail-sheet').getBoundingClientRect();
    return { beforeWidth:smokeList.width,afterWidth:list.getBoundingClientRect().width,beforeScroll:smokeList.scroll,
      afterScroll:list.scrollTop,sameContent:list.textContent===smokeList.html,right:sheet.right,width:sheet.width,viewport:innerWidth };
  })()`);
  checks.drawerPreservesList = await evaluate(`(() => {
    const list=document.querySelector('#directory'), sheet=document.querySelector('#task-detail-sheet').getBoundingClientRect();
    return list.getBoundingClientRect().width===smokeList.width && list.scrollTop===smokeList.scroll
      && list.textContent===smokeList.html && document.querySelector('#history-type').value==='保留未应用条件'
      && Math.abs(sheet.right-innerWidth)<1 && sheet.width<innerWidth*0.6
      && document.querySelectorAll('[role=dialog]').length===1;
  })()`);
  assert.equal(checks.drawerPreservesList, true, JSON.stringify(checks.drawerGeometry));
  await click('[data-slot="sheet-overlay"]');
  await wait("!document.querySelector('[role=dialog]')");
  checks.backdropDismissal = true;
  await wait("document.activeElement===smokeOpener");
  checks.drawerFocusReturned = true;
  await click(row);
  await wait("document.querySelector('#task-detail [data-action=\"查看关联执行 →\"]')");
  await click('#task-detail [data-action="查看关联执行 →"]');
  await wait("document.querySelector('#execution-detail button[data-action$=\"→\"]')");
  await delay(100);
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[role=dialog]').length===1 && document.querySelector('#tasks').hidden && !!document.activeElement.closest('#execution-detail-sheet')",
    ),
    true,
  );
  await click('#execution-detail button[data-action$="→"]');
  await wait("document.querySelector('#task-detail [data-key=task-snapshot]')");
  await delay(100);
  checks.relatedNavigation = await evaluate(
    "document.querySelectorAll('[role=dialog]').length===1 && document.querySelector('#executions').hidden && !!document.activeElement.closest('#task-detail-sheet')",
  );
  assert.equal(checks.relatedNavigation, true);
  await closeOverlay();
  assert.equal(
    await evaluate("document.querySelector('#directory').scrollTop===smokeList.scroll"),
    true,
  );
  await click("#tab-executions");
  await click("#execution-actions button");
  await wait("document.querySelectorAll('#execution-directory tbody tr').length===10");
  await click('#execution-directory [data-action="执行目录下一页"]');
  await wait("document.querySelectorAll('#execution-directory tbody tr').length===14");
  const externalExecution = backend.engine.getTask(external.taskId, {
    scope: "fixture",
    subject: "ui",
  }).execution!.executionId;
  checks.externalExecutionListed = await evaluate(
    `document.querySelector('#execution-directory').textContent.includes(${JSON.stringify(externalExecution.slice(-8))})`,
  );
  assert.equal(checks.externalExecutionListed, true);
  await screenshot("executions.png");
  const executionRow = "#execution-directory tbody tr:nth-child(1) button";
  const executionWidth = await evaluate<number>(
    "document.querySelector('#execution-directory').getBoundingClientRect().width",
  );
  await click(executionRow);
  await wait("document.querySelector('#execution-detail')?.textContent.includes('观察已结束')");
  assert.equal(
    await evaluate("document.querySelector('#execution-directory').getBoundingClientRect().width"),
    executionWidth,
  );
  await screenshot("execution-sheet.png");
  await closeOverlay();
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click("#tab-tasks");
  await evaluate("scrollTo(0,0);true");
  checks.narrowFits = await evaluate("document.documentElement.scrollWidth <= innerWidth");
  assert.equal(checks.narrowFits, true);
  checks.newTaskUnwrapped = await evaluate(
    "(() => { const button=document.querySelector('#new-task'); return getComputedStyle(button).whiteSpace==='nowrap' && button.scrollWidth<=button.clientWidth; })()",
  );
  assert.equal(checks.newTaskUnwrapped, true);
  await screenshot("narrow.png");
  await click(row);
  await wait("document.querySelector('#task-detail-sheet')");
  await wait(
    "!document.querySelector('#task-detail-sheet').getAnimations().some(animation=>animation.playState==='running')",
  );
  checks.narrowDrawerFits = await evaluate(`(() => {
    const sheet=document.querySelector('#task-detail-sheet'), rect=sheet.getBoundingClientRect();
    return rect.left>=0 && rect.right<=innerWidth+1 && sheet.scrollWidth<=sheet.clientWidth
      && getComputedStyle(document.querySelector('.detail-scroll')).overflowY==='auto'
      && document.documentElement.scrollWidth<=innerWidth;
  })()`);
  assert.equal(checks.narrowDrawerFits, true);
  await screenshot("narrow-sheet.png");
  await closeOverlay();
  const redoSource = await evaluate<string>(
    "document.querySelector('#directory tbody tr:nth-child(4)').dataset.key.split(':').at(-1)",
  );
  await click('#directory tbody tr:nth-child(4) [data-action="重做"]');
  await wait("document.querySelector('#task-detail [data-key=task-snapshot]')");
  const redone = await evaluate<string>(
    "JSON.parse(document.querySelector('#task-detail [data-key=task-snapshot] pre').textContent).taskId",
  );
  checks.glyphRedoAction =
    redone !== redoSource &&
    backend.engine.getTask(redone, { scope: "fixture", subject: "ui" }).requestId !==
      backend.engine.getTask(redoSource, { scope: "fixture", subject: "ui" }).requestId;
  assert.equal(checks.glyphRedoAction, true);
  await closeOverlay();
  checks.cspViolations = await evaluate("smokeCsp");
  assert.deepEqual(checks.cspViolations, []);
  await evaluate(`(() => {
    const style=document.createElement('style');style.textContent='body{--blocked-probe:blocked}';
    document.head.append(style);globalThis.smokeBadStyle=style;
    const script=document.createElement('script');script.textContent='globalThis.smokeInlineRan=true';
    document.head.append(script);script.remove();
  })()`);
  await wait("smokeCsp.length>=2");
  checks.cspRejectsInline = await evaluate(
    "!globalThis.smokeInlineRan && !getComputedStyle(document.body).getPropertyValue('--blocked-probe') && smokeCsp.some(e=>e.directive==='script-src-elem') && smokeCsp.some(e=>e.directive==='style-src-elem')",
  );
  assert.equal(checks.cspRejectsInline, true);
  await evaluate("smokeBadStyle.remove();true");
  assert.equal(exceptions.length, 0, "no unhandled browser exceptions");
  console.log(JSON.stringify({ ...checks, ownedUi: ui.url, ownedBackend: backend.url }));
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN) {
    await screenshot("failure.png").catch(() => {});
    await writeFile(
      resolve(output, "failure.json"),
      JSON.stringify(
        {
          checks,
          error: String(error),
          state: await evaluate(`({
        notice:document.querySelector('#notice')?.textContent,
        dialog:document.querySelector('[role=dialog]')?.textContent,
        active:document.activeElement?.outerHTML,
        csp:globalThis.smokeCsp
      })`).catch(() => null),
        },
        null,
        2,
      ),
    );
  }
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) await call("Browser.close", {}, 2000).catch(() => {});
  socket?.close();
  for (const request of pending.values()) clearTimeout(request.timer);
  if (browser?.pid && browser.exitCode === null && browser.signalCode === null) {
    await Promise.race([once(browser, "exit"), delay(3000)]);
    if (browser.exitCode === null && browser.signalCode === null)
      spawnSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Stop-Process -Id ${browser.pid} -Force -ErrorAction SilentlyContinue`,
      ]);
  }
  await ui?.close();
  await backend?.close();
  await resources.close();
  delete process.env[env];
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  await rm(resolve(output, ".favorites.json"), { force: true });
}
await writeFile(resolve(output, "checks.json"), JSON.stringify(checks, null, 2));
