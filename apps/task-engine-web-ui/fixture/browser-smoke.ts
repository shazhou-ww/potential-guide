import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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
    if (await evaluate(expression)) return;
    await delay(50);
  }
  throw new Error(`UI condition timed out: ${expression}`);
}
async function screenshot(name: string) {
  const result = await call<{ data: string }>("Page.captureScreenshot", { format: "png" });
  await writeFile(resolve(output, name), Buffer.from(result.data, "base64"));
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
        label: "独立 v0.5 验证",
        binding: "owned-v05",
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
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call("Page.navigate", { url: ui.url });
  await wait("document.querySelector('#discovery-status')?.textContent.includes('已发现 2')");
  checks.tabs = await evaluate("document.querySelectorAll('[role=tab]').length");
  checks.visiblePanels = await evaluate(
    "document.querySelectorAll('main [role=tabpanel]:not([hidden])').length",
  );
  assert.equal(checks.tabs, 2);
  assert.equal(checks.visiblePanels, 1);
  await evaluate(
    "document.querySelector('#new-task').focus();document.querySelector('#new-task').click();true",
  );
  await wait("document.querySelector('#create-dialog').open");
  await evaluate(`(() => {
    const type=document.querySelector('#type'); type.value='echo'; type.dispatchEvent(new Event('change'));
    for (const [label,value] of [['消息','独立浏览器验证'],['超时预算 timeoutMs（毫秒）','10000']]) {
      const item=[...document.querySelectorAll('#form-fields label')].find(item=>item.htmlFor&&item.textContent===label);
      document.getElementById(item.htmlFor).value=value;
    }
    const toggle=[...document.querySelectorAll('#form-fields input[type=checkbox]')].find(item=>item.parentElement.textContent.includes('durationMs'));
    toggle.click(); const label=[...document.querySelectorAll('#form-fields label')].find(item=>item.htmlFor&&item.textContent==='durationMs');
    document.getElementById(label.htmlFor).value='1200';
    globalThis.smokeDraft=[...document.querySelectorAll('#form-fields input')].find(item=>item.value==='独立浏览器验证');
    return true;
  })()`);
  await screenshot("popup.png");
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await wait("!document.querySelector('#create-dialog').open");
  checks.focusReturned = await evaluate("document.activeElement.id==='new-task'");
  assert.equal(checks.focusReturned, true);
  await evaluate("document.querySelector('#tab-executions').click();true");
  await wait("document.querySelector('#execution-directory').textContent.includes('survey')");
  assert.equal(await evaluate("document.querySelector('#tasks').hidden"), true);
  await evaluate(
    "document.querySelector('#tab-tasks').click();document.querySelector('#new-task').click();true",
  );
  checks.draftRetained = await evaluate(
    "globalThis.smokeDraft.isConnected && globalThis.smokeDraft.value==='独立浏览器验证'",
  );
  assert.equal(checks.draftRetained, true);
  await evaluate(
    "[...document.querySelectorAll('#create-actions button')].find(item=>item.textContent==='提交任务').click();true",
  );
  await wait("document.querySelector('#task-detail').textContent.includes('观察已结束')");
  assert.equal(await evaluate("document.querySelector('#create-dialog').open"), false);
  const stamp = await evaluate(
    "document.querySelector('#task-detail .observation-state').textContent",
  );
  await delay(350);
  checks.observationStopped =
    stamp ===
    (await evaluate("document.querySelector('#task-detail .observation-state').textContent"));
  assert.equal(checks.observationStopped, true);
  await evaluate(
    "[...document.querySelectorAll('#history-actions button')].find(item=>item.textContent==='重新查询').click();true",
  );
  await wait("document.querySelectorAll('#directory tbody tr').length===2");
  await evaluate("document.querySelector('#directory .star').click();true");
  await wait("document.querySelector('#directory .star').getAttribute('aria-pressed')==='true'");
  await screenshot("tasks.png");
  await evaluate(
    "document.querySelector('#tab-executions').click();[...document.querySelectorAll('#execution-actions button')][0].click();true",
  );
  await wait("document.querySelectorAll('#execution-directory tbody tr').length===2");
  const externalExecution = backend.engine.getTask(external.taskId, {
    scope: "fixture",
    subject: "ui",
  }).execution!.executionId;
  checks.externalExecutionListed = await evaluate(
    `document.querySelector('#execution-directory').textContent.includes(${JSON.stringify(externalExecution.slice(-8))})`,
  );
  assert.equal(checks.externalExecutionListed, true);
  await evaluate("document.querySelector('#execution-directory tbody button').click();true");
  await wait("document.querySelector('#execution-detail').textContent.includes('观察已结束')");
  await screenshot("executions.png");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate("document.querySelector('#tab-tasks').click();scrollTo(0,0);true");
  checks.narrowFits = await evaluate("document.documentElement.scrollWidth <= innerWidth");
  assert.equal(checks.narrowFits, true);
  checks.newTaskUnwrapped = await evaluate(
    "(() => { const button=document.querySelector('#new-task'); return getComputedStyle(button).whiteSpace==='nowrap' && button.scrollWidth<=button.clientWidth; })()",
  );
  assert.equal(checks.newTaskUnwrapped, true);
  await screenshot("narrow.png");
  assert.equal(exceptions.length, 0, "no unhandled browser exceptions");
  console.log(JSON.stringify({ ...checks, ownedUi: ui.url, ownedBackend: backend.url }));
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
