import type {
  BundleCacheDetail,
  BundleCachePage,
  BundleReference,
  HistoryPage,
  Observation,
  PublicEvent,
  RunLogPage,
  RunPage,
  RunSnapshot,
  RunStage,
  RunSummary,
  SubmissionResult,
  TaskPage,
  TaskSnapshot,
} from "@potential-guide/task-protocol";
import { bundleCid, formatBundleReference } from "@potential-guide/task-protocol/bundle-reference";
import { observeDirectory } from "./directory-observation.js";
import { envelopeKeys, envelopeSchema, schemaEditor } from "./form.js";
import { ObservationEnd, taskStatus, taskStatusExplanation } from "./lifecycle.js";
import {
  Api,
  ApiError,
  bundleIdentity,
  consumeCollectionSse,
  consumeSse,
  Directory,
  type Entry,
  EventWindow,
  endpointMatches,
  eventKey,
  originalParameters,
  type Parameters,
  Selection,
  SubmissionBar,
  sourcePosition,
  TaskSnapshots,
  validRunSnapshot,
  validSnapshot,
} from "./model.js";
import {
  type DirectoryRowDescription,
  describeAction,
  describeRowAction,
  type InlineAction,
  WorkbenchView,
} from "./presentation.tsx";
import { consumeRunLogSse, RunLogWindow } from "./run-logs.js";
import type { Endpoint, Favorite } from "./server.js";

const view = new WorkbenchView(document.getElementById("app")!);
const navigation = view.navigation;
function reconcile(id: string, nodes: HTMLElement[]): void {
  view.render(id, nodes);
}
function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}
function get(id: string): HTMLElement {
  if (id === "form-fields") return view.form;
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing UI element ${id}`);
  return result;
}
function button(
  text: string,
  action: () => void | Promise<void>,
  disabled = false,
  minimumInterval = 0,
  glyph?: InlineAction,
): HTMLButtonElement {
  const result = node("button", text);
  result.type = "button";
  result.disabled = disabled;
  result.dataset.disabled = String(disabled);
  result.dataset.action = text;
  result.dataset.key = `action:${text}`;
  describeAction(result, {
    run: action,
    error: notify,
    minimumInterval,
    ...(glyph ? { glyph } : {}),
  });
  return result;
}
function inlineButton(
  text: InlineAction,
  action: () => void | Promise<void>,
  disabled = false,
): HTMLButtonElement {
  return button(text, action, disabled, 0, text);
}
function details(title: string, value: unknown, key = title): HTMLDetailsElement {
  const result = node("details");
  result.dataset.key = key;
  result.append(node("summary", title), node("pre", JSON.stringify(value, null, 2)));
  return result;
}
function notify(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  report("操作", message, selection.endpoint, true);
  view.publish();
}
function inform(message: string): void {
  view.text("notice", message);
  view.text("dialog-notice", message);
}
function report(
  source: string,
  message: string,
  endpoint = selection.endpoint,
  event = false,
): void {
  view.error(
    `${endpoint?.id ?? "UI"}:${endpoint?.binding ?? ""} / ${source}`,
    message,
    event,
    `${endpoint?.label ?? "UI"} / ${source.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, (id) => id.slice(-8))}`,
  );
}
function bundleReference(bundle: BundleReference): HTMLElement {
  const result = node("code", formatBundleReference(bundle));
  result.className = "bundle-reference";
  return result;
}
function compactBundle(digest: string): HTMLElement {
  const result = node("code", `${digest.slice(0, 16)}…`);
  result.className = "bundle-digest";
  result.title = digest;
  result.setAttribute("aria-label", `Bundle CID ${digest}`);
  return result;
}
function copyCid(digest: string): HTMLButtonElement {
  return button("复制完整 CID", async () => {
    await navigator.clipboard.writeText(digest);
    inform("已复制完整 Bundle CID。");
  });
}
const statusNames = {
  draft: "草稿",
  sending: "提交中",
  preparing: "制品准备中",
  accepted: "已确认",
  failed: "被拒绝",
  unknown: "结果未知",
};
let api: Api;
let endpoints: Endpoint[] = [];
let favorites: Favorite[] = [];
let favoritesGeneration = 0;
const sourceStates = new Map<string, { label: string }>();
const selection = new Selection();
let cacheGeneration = 0;
let cachePage: BundleCachePage | undefined;
let cacheDetail: BundleCacheDetail | undefined;
let cacheConfirm: string | undefined;
let cacheError = "";
let cacheBusy = false;
function renderCache(): void {
  const endpoint = selection.endpoint;
  if (!endpoint) return;
  const box = node("div");
  box.className = "cache-layout";
  box.dataset.key = `cache:${endpoint.binding}`;
  report("Bundle 缓存", cacheError);
  const footer = node("footer");
  footer.className = "directory-grid-footer cache-footer";
  const summary = node("p");
  summary.setAttribute("role", "status");
  summary.textContent = `${cachePage ? `本页 ${cachePage.items.length} 项 · 观察于 ${cachePage.observedAt}` : "尚未取得缓存目录"} · ${cacheError ? "查询失败 / 数据待核对，详见错误日志" : cacheBusy ? "正在读取或清理缓存…" : "缓存快照；不是全缓存容量统计"}`;
  footer.append(
    summary,
    button("刷新缓存", () => loadCache(), cacheBusy),
  );
  if (cachePage) {
    const table = node("table");
    const head = node("thead");
    const heading = node("tr");
    for (const label of ["Bundle / CID", "内容大小", "占用", "操作"])
      heading.append(node("th", label));
    head.append(heading);
    table.append(head);
    const body = node("tbody");
    for (const item of cachePage.items) {
      const row = node("tr");
      row.dataset.key = item.cid;
      const identity = node("td");
      identity.append(node("strong", item.name ?? "正在准备"), compactBundle(item.cid));
      const controls = node("td");
      controls.append(
        inlineButton("查看契约", () => readCacheDetail(item.cid), cacheBusy),
        inlineButton(
          "清理此缓存",
          () => {
            cacheConfirm = item.cid;
            renderCache();
            navigation.open("cache-confirm");
          },
          cacheBusy || item.preparing || item.leases > 0,
        ),
      );
      row.append(
        identity,
        node(
          "td",
          item.bytes === undefined
            ? "尚未缓存"
            : `${item.bytes.toLocaleString()} 字节 / ${item.files} 文件`,
        ),
        node(
          "td",
          `${item.preparing ? "准备中" : "未在准备"} · ${item.leases} 个占用租约（不等于 Task 数）`,
        ),
        controls,
      );
      body.append(row);
    }
    table.append(body);
    const scroll = node("div");
    scroll.className = "cache-grid-scroll";
    scroll.append(table);
    box.append(scroll);
    if (!cachePage.items.length)
      box.append(node("p", "当前页没有缓存 Bundle。可运行任务后刷新；不会自动下载内容。"));
    if (cachePage.next)
      footer.append(button("下一页缓存", () => loadCache(cachePage!.next), cacheBusy));
  }
  box.append(footer);
  if (cacheConfirm) {
    const digest = cacheConfirm;
    const confirm = node("section");
    confirm.dataset.key = `remove:${digest}`;
    confirm.append(
      node(
        "p",
        `确认清理 ${digest}？只移除 Engine 内容保护与元数据，不删除任务、历史或共享 IPFS pin。再次运行需重新验证内容。`,
      ),
      button("确认清理", () => removeCache(digest), cacheBusy),
      button(
        "保留缓存",
        () => {
          cacheConfirm = undefined;
          navigation.close("cache-confirm");
        },
        cacheBusy,
      ),
    );
    view.render("cache-confirmation", [confirm]);
  }
  if (cacheDetail)
    view.render("cache-detail", [
      node("p", cacheDetail.cid),
      copyCid(cacheDetail.cid),
      details("Bundle 声明与解析后契约", cacheDetail, `cache-detail:${cacheDetail.cid}`),
    ]);
  reconcile("bundle-cache", [box]);
}
async function loadCache(after?: string): Promise<void> {
  if (!selection.endpoint) return;
  const endpoint = selection.endpoint,
    lease = selection.capture(),
    generation = ++cacheGeneration;
  cacheBusy = true;
  cacheError = "";
  cacheConfirm = undefined;
  cacheDetail = undefined;
  renderCache();
  try {
    const query = new URLSearchParams({ limit: "50", ...(after ? { after } : {}) });
    const page = await api.request<BundleCachePage>(endpoint, `/bundle-cache?${query}`, {
      signal: lease.signal,
    });
    if (!lease.current() || generation !== cacheGeneration) return;
    if (!Array.isArray(page.items) || typeof page.observedAt !== "string")
      throw new Error("缓存列表协议无效。");
    cachePage = page;
  } catch (error) {
    if (lease.current() && generation === cacheGeneration)
      cacheError = `缓存读取失败；旧页仅供参考。${String(error)}`;
  } finally {
    if (lease.current() && generation === cacheGeneration) {
      cacheBusy = false;
      renderCache();
    }
  }
}
async function readCacheDetail(digest: string): Promise<void> {
  const endpoint = workspace().endpoint,
    lease = selection.capture(),
    generation = ++cacheGeneration;
  cacheBusy = true;
  cacheError = "";
  renderCache();
  try {
    const detail = await api.request<BundleCacheDetail>(endpoint, `/bundle-cache/${digest}`, {
      signal: lease.signal,
    });
    if (!lease.current() || generation !== cacheGeneration) return;
    if (detail.cid !== digest) throw new Error("缓存详情身份不一致。");
    cacheDetail = detail;
    navigation.open("cache-detail");
  } catch (error) {
    if (lease.current() && generation === cacheGeneration)
      cacheError = `契约读取失败：${String(error)}`;
  } finally {
    if (lease.current() && generation === cacheGeneration) {
      cacheBusy = false;
      renderCache();
    }
  }
}
async function removeCache(digest: string): Promise<void> {
  const endpoint = workspace().endpoint,
    lease = selection.capture(),
    generation = ++cacheGeneration;
  cacheBusy = true;
  cacheError = "";
  renderCache();
  try {
    const receipt = await api.request<{ removed: boolean; cid: string }>(
      endpoint,
      `/bundle-cache/${digest}`,
      { method: "DELETE", signal: lease.signal },
    );
    if (!lease.current() || generation !== cacheGeneration) return;
    if (receipt.removed !== true || receipt.cid !== digest)
      throw new Error("清理回执无效；结果未知，请刷新核对。");
    navigation.close("cache-confirm");
    await loadCache();
  } catch (error) {
    if (lease.current() && generation === cacheGeneration)
      cacheError = `清理未确认：${String(error)}。不会停止 Run；请刷新核对缓存状态。`;
  } finally {
    if (lease.current() && generation === cacheGeneration) {
      cacheBusy = false;
      renderCache();
    }
  }
}
const states = new Map<string, Workspace>();
let formReader: (() => Parameters) | undefined;
let formEndpoint: Endpoint | undefined;
let formBlocked = false;
let lastQuick: Entry | undefined;
interface Workspace {
  endpoint: Endpoint;
  tasks: TaskSnapshots;
  directory: Directory;
  taskCollection?: AbortController;
  runCollection?: AbortController;
  executionDirectory: Directory<RunPage>;
  associatedExecutionId: string;
}
function workspace(endpoint = selection.endpoint): Workspace {
  if (!endpoint) throw new Error("请先配置并选择 Endpoint。");
  let state = states.get(endpoint.binding);
  if (!state) {
    state = {
      endpoint,
      tasks: new TaskSnapshots(),
      directory: new Directory(),
      executionDirectory: new Directory<RunPage>("runs"),
      associatedExecutionId: "",
    };
    states.set(endpoint.binding, state);
  }
  return state;
}
function preserveSelectedCancellation(endpoint: Endpoint, id: string): void {
  // The selected detail owns its confirmed fact even if the bounded list cache evicts it.
  const selected = taskObserver;
  if (
    selected &&
    current(selected) &&
    endpointMatches(selected.endpoint, endpoint) &&
    selected.id === id &&
    selected.snapshot?.canceledAt !== undefined &&
    workspace(endpoint).tasks.values.get(id)?.canceledAt === undefined
  )
    workspace(endpoint).tasks.confirmCancellation(id, selected.snapshot);
}
const bar = new SubmissionBar(
  (entry) =>
    api.request<SubmissionResult>(entry.endpoint, "/tasks", {
      method: "POST",
      body: entry.parameters,
      headers: { "Idempotency-Key": entry.id },
    }),
  () => {
    renderBar();
    renderTasks();
  },
  (entry) => {
    if (entry.snapshot) {
      preserveSelectedCancellation(entry.endpoint, entry.snapshot.taskId);
      workspace(entry.endpoint).tasks.seed(entry.snapshot);
    }
  },
  (entry) => api.request<SubmissionResult>(entry.endpoint, `/requests/${entry.id}/status`),
  (entry, id) => api.request<TaskSnapshot>(entry.endpoint, `/tasks/${id}`),
);
function checkedForm(): { endpoint: Endpoint; parameters: Parameters; revision: string } {
  if (
    !formReader ||
    !formEndpoint ||
    formBlocked ||
    !selection.endpoint ||
    !endpointMatches(formEndpoint, selection.endpoint)
  )
    throw new Error("请先选择 Endpoint 并填写完整 Bundle 引用；原输入不会自动提交。");
  const parameters = formReader();
  return { endpoint: formEndpoint, parameters, revision: bundleIdentity(parameters) };
}
function renderForm(parameters?: Parameters): void {
  formReader = undefined;
  formBlocked = false;
  formEndpoint = workspace().endpoint;
  view.render("contract-actions", []);
  const container = get("form-fields");
  container.replaceChildren();
  const original = parameters ?? {};
  const envelope = Object.fromEntries(
    Object.entries(original).filter(([key]) => envelopeKeys.includes(key)),
  );
  const business = Object.fromEntries(
    Object.entries(original).filter(([key]) => !envelopeKeys.includes(key)),
  );
  try {
    const common = schemaEditor(envelopeSchema, envelope, envelopeSchema, "请求参数");
    const inputSchema = { type: "object" };
    const fields = schemaEditor(inputSchema, business, inputSchema, "业务 Input（JSON 对象）");
    container.append(common.node, fields.node);
    formReader = () => {
      const payload = fields.read() as Record<string, unknown>;
      if ([...envelopeKeys, "requestId"].some((key) => Object.hasOwn(payload, key)))
        throw new Error("业务 Input 不得覆盖 Bundle 引用、Request 身份或时间参数。");
      return { ...(common.read() as object), ...payload } as Parameters;
    };
    view.text(
      "contract",
      "填写根 CID 或 {cid,hint} 固定 Bundle 内容；hint 不参与匹配。完整准备前不创建 Task，也不开始 Task 超时。",
    );
  } catch (error) {
    formBlocked = true;
    container.append(details("保留的原参数", original));
    notify(error);
  }
}
async function initializeForm(): Promise<void> {
  renderForm();
  view.text("discovery-status", "无需类型注册或发现；名称仅用于展示，CID 决定执行内容。");
}
function renderBar(): void {
  const container = "batches";
  const current = selection.endpoint;
  const cards: HTMLElement[] = [];
  const batches = bar.batches.filter(
    (batch) => current && endpointMatches(batch.endpoint, current),
  );
  const unknown = batches
    .flatMap((batch) => batch.entries)
    .filter((entry) => entry.state === "unknown").length;
  view.text(
    "bar-count",
    `${batches.reduce((n, batch) => n + batch.entries.length, 0)} 项${unknown ? ` · ${unknown} 未知` : ""}`,
  );
  for (const batch of batches) {
    const card = node("article");
    card.dataset.key = `batch:${batch.id}`;
    card.append(node("h3", `${batch.entries.length} 项 · ${batch.id.slice(-8)}`));
    const send = button(
      "提交此批",
      async () => {
        await bar.sendBatch(batch);
        if (navigation.overlay?.id === "create-dialog")
          get("batches")
            .querySelector<HTMLElement>(`[data-key="batch:${batch.id}"] summary`)
            ?.focus();
      },
      batch.sending || !batch.entries.every((entry) => entry.state === "draft"),
    );
    if (batch.sending || batch.entries.every((entry) => entry.state === "draft")) card.append(send);
    for (const [index, entry] of batch.entries.entries()) {
      report(
        `Request:${entry.id}`,
        entry.state === "failed" || entry.state === "unknown" ? entry.message : "",
        batch.endpoint,
      );
      const row = node("div");
      row.dataset.key = `receipt:${entry.id}`;
      row.className = "receipt";
      row.append(
        node(
          "strong",
          `${index + 1}. ${bundleCid(entry.parameters.bundle).slice(0, 19)} · ${statusNames[entry.state]}`,
        ),
        node("p", entry.message),
      );
      row.append(bundleReference(entry.parameters.bundle));
      row.append(
        details("提交参数与原身份", {
          endpoint: entry.endpoint.id,
          requestId: entry.id,
          ...(entry.taskId ? { taskId: entry.taskId } : {}),
          bundleCid: entry.revision,
          parameters: entry.parameters,
        }),
      );
      if (entry.state === "draft") {
        row.append(
          inlineButton("上移", () => bar.move(batch, index, -1), index === 0 || batch.sending),
        );
        row.append(
          inlineButton(
            "下移",
            () => bar.move(batch, index, 1),
            index === batch.entries.length - 1 || batch.sending,
          ),
        );
      }
      if (entry.taskId)
        row.append(
          button(`打开 Task ${entry.taskId.slice(-8)}`, () => {
            if (!selection.endpoint || !endpointMatches(entry.endpoint, selection.endpoint))
              throw new Error("原 Endpoint 已变化，禁止静默改投。");
            return openTask(entry.taskId!);
          }),
        );
      if (["preparing", "unknown", "failed"].includes(entry.state))
        row.append(button("按 requestId 核对结果", () => bar.refresh(entry)));
      if (entry.state === "unknown" || entry.state === "failed") {
        row.append(button("原身份重试（保留原意图）", () => bar.retry(entry)));
        row.append(
          button("核对原 requestId", async () => {
            const value = await api.request<Record<string, unknown>>(
              entry.endpoint,
              `/requests/${entry.id}`,
            );
            if (selection.endpoint && endpointMatches(entry.endpoint, selection.endpoint))
              inform(
                `原请求可读；不代表已创建 Task。请另查处理结果。requestId=${String(value.requestId)}。`,
              );
          }),
        );
      }
      if (entry.state !== "draft" && entry.state !== "sending")
        row.append(
          button("主动再做一次（新身份）", () => reuse(entry.endpoint, entry.parameters, true)),
        );
      card.append(row);
    }
    if (
      !batch.sending &&
      batch.entries.every((entry) => ["accepted", "failed", "draft"].includes(entry.state))
    )
      card.append(
        button("移除此本地批次", () => {
          bar.batches.splice(bar.batches.indexOf(batch), 1);
          renderBar();
          if (navigation.overlay?.id === "create-dialog")
            get("create-dialog").querySelector<HTMLElement>("#batch-title")?.focus();
        }),
      );
    cards.push(card);
  }
  if (!batches.length)
    cards.push(node("p", "尚未加入批量。填写任务后点“加入批量”，或直接提交当前任务。"));
  reconcile(container, cards);
}
function renderTasks(): void {
  const container = "task-list";
  const rows: HTMLElement[] = [];
  if (!selection.endpoint) {
    reconcile(container, rows);
    view.recent = false;
    view.publish();
    return;
  }
  for (const task of [...workspace().tasks.values.values()].slice(-5)) {
    const row = node("div");
    row.dataset.key = `${selection.endpoint.binding}:task:${task.taskId}`;
    row.className = "task-row";
    const taskLink = button(`${taskStatus(task)} · ${task.taskId.slice(-6)}`, () =>
      openTask(task.taskId),
    );
    taskLink.title = taskStatusExplanation(task);
    taskLink.dataset.key = "open-task";
    row.append(taskLink, node("span", `快照 ${task.timestamp}`));
    if (task.run)
      row.append(button(`Run ${task.run.runId.slice(-8)}`, () => openRun(task.run!.runId)));
    rows.push(row);
  }
  view.recent = rows.length > 0;
  reconcile(container, rows);
}
interface Observer {
  logs: RunLogWindow;
  logController?: AbortController;
  logState: "loading" | "following" | "paused" | "disconnected" | "ended";
  logError: string;
  logLoading: boolean;
  logGeneration: number;
  kind: "taskId" | "runId";
  id: string;
  endpoint: Endpoint;
  window: EventWindow;
  historyEvents: PublicEvent[];
  controller: AbortController;
  streamController?: AbortController;
  associatedController?: AbortController;
  streamState: "idle" | "live" | "stale" | "paused" | "ended";
  end: ObservationEnd;
  executionState: "unknown" | RunStage;
  runSnapshot?: RunSnapshot;
  sourceWatermark: number;
  reclaimed: boolean;
  executionSummary?: RunSummary;
  associated: Directory;
  template?: Favorite;
  snapshot?: TaskSnapshot;
  request?: Record<string, unknown>;
  message: string;
  detailError: string;
  requestError: string;
  historyError: string;
  loading: boolean;
}
let taskObserver: Observer | undefined;
let executionObserver: Observer | undefined;
function current(observer: Observer): boolean {
  return (
    !observer.controller.signal.aborted &&
    !!selection.endpoint &&
    endpointMatches(observer.endpoint, selection.endpoint) &&
    (observer.kind === "taskId" ? taskObserver === observer : executionObserver === observer)
  );
}
function closeObservers(): void {
  taskObserver?.controller.abort();
  executionObserver?.controller.abort();
  taskObserver = undefined;
  executionObserver = undefined;
  view.text("task-detail", "选择一个 Task 查看详情。");
  view.text("execution-detail", "选择关联 Run 查看完整尝试事实。");
}
async function history(observer: Observer, next = false): Promise<void> {
  if (observer.loading) return;
  observer.loading = true;
  try {
    const query = new URLSearchParams({ [observer.kind]: observer.id, limit: "50" });
    if (next && observer.window.historyNext) query.set("cursor", observer.window.historyNext);
    const page = await api.request<HistoryPage>(observer.endpoint, `/event-history?${query}`, {
      signal: observer.controller.signal,
    });
    if (!current(observer)) return;
    observer.window.history(page);
    observer.historyEvents = page.events;
    updateFacts(observer, page.events);
    if (!observer.window.streamCursor) observer.window.streamCursor = page.cursor;
    observer.historyError = "";
  } catch (error) {
    if (!current(observer)) return;
    observer.historyError = String(error);
    if (error instanceof ApiError && error.status === 410)
      observer.window.gap = "历史已失效或存在缺口；原视图仅供参考。请显式重新观察。";
  } finally {
    observer.loading = false;
    if (current(observer)) renderObserver(observer);
  }
}
async function live(observer: Observer): Promise<void> {
  if (
    observer.streamState === "paused" ||
    observer.streamState === "ended" ||
    (observer.streamController && !observer.streamController.signal.aborted)
  )
    return;
  const controller = new AbortController();
  observer.streamController = controller;
  const abort = () => controller.abort();
  observer.controller.signal.addEventListener("abort", abort, { once: true });
  const liveCurrent = () =>
    current(observer) && !controller.signal.aborted && observer.streamController === controller;
  let failures = 0;
  try {
    while (liveCurrent() && failures < 5) {
      try {
        const query = new URLSearchParams({ [observer.kind]: observer.id });
        const response = await fetch(api.path(observer.endpoint, `/events?${query}`), {
          headers: api.headers(
            observer.endpoint,
            observer.window.streamCursor ? { "Last-Event-ID": observer.window.streamCursor } : {},
          ),
          signal: controller.signal,
        });
        if (!response.ok) await api.decode(response);
        await consumeSse(response, (observation: Observation) => {
          if (!liveCurrent()) return;
          observer.window.observation(observation);
          observer.streamState = "live";
          observer.message = "";
          failures = 0;
          for (const snapshot of observation.snapshots) {
            const tasks = workspace(observer.endpoint).tasks;
            preserveSelectedCancellation(observer.endpoint, snapshot.taskId);
            const accepted = tasks.observe(snapshot, observation.watermark);
            if (accepted && observer.kind === "taskId" && snapshot.taskId === observer.id) {
              const retained = workspace(observer.endpoint).tasks.values.get(snapshot.taskId);
              if (retained) observer.snapshot = retained;
            }
          }
          updateFacts(observer, observation.events);
          renderTasks();
          renderObserver(observer);
        });
        if (!liveCurrent()) return;
        observer.message = "流已断开，按最后确认游标续接；不会重提任务。";
      } catch (error) {
        if (!liveCurrent()) return;
        observer.message = String(error);
        if (error instanceof ApiError && [400, 401, 403, 404, 410, 429].includes(error.status)) {
          observer.window.gap = "流不可续接；请核对权限/保留期限后显式重新观察，不能保证事件完整。";
          failures = 5;
        } else failures++;
      }
      observer.window.stale = true;
      observer.streamState = "stale";
      report(`${observer.kind}:${observer.id} / 事件流`, observer.message, observer.endpoint, true);
      renderObserver(observer);
      if (failures < 5)
        await new Promise<void>((resolveDelay) => {
          const finish = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", finish);
            resolveDelay();
          };
          const timer = setTimeout(finish, Math.min(1000 * (failures + 1), 5000));
          controller.signal.addEventListener("abort", finish, { once: true });
          if (controller.signal.aborted) finish();
        });
    }
  } finally {
    observer.controller.signal.removeEventListener("abort", abort);
  }
}
function stopStream(observer: Observer, state: "paused" | "ended"): void {
  observer.streamState = state;
  observer.window.stale = state !== "ended";
  observer.streamController?.abort();
}
function updateFacts(observer: Observer, events: PublicEvent[]): void {
  for (const event of events)
    if (observer.kind === "taskId" && event.taskId === observer.id) {
      const snapshot = (event.data as { snapshot?: unknown }).snapshot;
      if (validSnapshot(snapshot)) {
        const tasks = workspace(observer.endpoint).tasks;
        if (tasks.observe(snapshot, event.sequence))
          observer.snapshot = tasks.values.get(observer.id) ?? snapshot;
      }
    }
  observer.end.feed(events, observer.snapshot);
  for (const event of events)
    if (observer.kind === "runId" && event.runId === observer.id) {
      observer.sourceWatermark = Math.max(observer.sourceWatermark, event.sequence);
      if (event.type === "run.started" && observer.executionState === "unknown")
        observer.executionState = "running";
      if (event.type === "run.reclaimed") observer.reclaimed = true;
      if (event.type === "run.exited") observer.executionState = "unknown";
    }
  if (observer.kind === "runId" && events.some((event) => event.runId === observer.id))
    void refreshRun(observer);
  if (observer.end.ended) stopStream(observer, "ended");
}
function newObserver(kind: Observer["kind"], id: string): Observer {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) throw new Error("请输入有效 ULID。");
  const previous = kind === "taskId" ? taskObserver : executionObserver;
  previous?.controller.abort();
  return {
    kind,
    id,
    logs: new RunLogWindow(id),
    logState: "loading",
    logError: "",
    logLoading: false,
    logGeneration: 0,
    endpoint: workspace().endpoint,
    window: new EventWindow(),
    historyEvents: [],
    controller: new AbortController(),
    streamState: "idle",
    end: new ObservationEnd(kind, id),
    executionState: "unknown",
    sourceWatermark: 0,
    reclaimed: false,
    associated: new Directory(),
    message: "",
    detailError: "",
    requestError: "",
    historyError: "",
    loading: false,
  };
}
async function openTask(id: string): Promise<void> {
  navigation.close("create-dialog", false);
  navigation.show("tasks", false);
  const observer = newObserver("taskId", id);
  taskObserver = observer;
  renderObserver(observer);
  navigation.open("task-detail");
  try {
    const accept = workspace(observer.endpoint).tasks.begin(id);
    const snapshot = await api.request<TaskSnapshot>(observer.endpoint, `/tasks/${id}`, {
      signal: observer.controller.signal,
    });
    if (!validSnapshot(snapshot) || snapshot.taskId !== id) throw new Error("Task 快照协议无效。");
    if (!current(observer)) return;
    accept(snapshot);
    observer.snapshot = workspace(observer.endpoint).tasks.values.get(id) ?? snapshot;
    observer.window.streamCursor = snapshot.revision;
    renderTasks();
    renderObserver(observer);
    // Request authorization is independent from task/history authorization.
    void api
      .request<Record<string, unknown>>(observer.endpoint, `/requests/${snapshot.requestId}`, {
        signal: observer.controller.signal,
      })
      .then((request) => {
        if (current(observer)) {
          observer.request = request;
          renderObserver(observer);
        }
      })
      .catch((error: unknown) => {
        if (current(observer)) {
          observer.requestError = `原参数不可读：${String(error)}`;
          renderObserver(observer);
        }
      });
  } catch (error) {
    if (current(observer)) {
      observer.detailError = String(error);
      const saved = favorites.find(
        (item) => item.source?.taskId === id && endpointMatches(item.endpoint, observer.endpoint),
      );
      if (saved) {
        observer.template = saved;
        observer.detailError =
          error instanceof ApiError && error.status === 404
            ? "来源已清理；以下是本机保存的完整参数模板，不是服务端任务快照。"
            : `来源不可访问：${String(error)}。可查看已保存模板。`;
        stopStream(observer, "paused");
      }
      renderObserver(observer);
    }
  }
  await history(observer);
  if (current(observer)) void live(observer);
}
async function openRun(id: string): Promise<void> {
  navigation.show("executions", false);
  if (!workspace().executionDirectory.page) void queryExecutions();
  const observer = newObserver("runId", id);
  executionObserver = observer;
  const summary = workspace().executionDirectory.page?.runs.find((item) => item.runId === id);
  if (summary) {
    observer.executionSummary = summary;
    observer.end.summary(summary);
    observer.executionState = summary.stage;
    observer.reclaimed = !!summary.reclaimedAt;
    if (observer.end.ended) stopStream(observer, "ended");
  }
  renderObserver(observer);
  navigation.open("execution-detail");
  await refreshRun(observer);
  void loadLogs(observer);
  await history(observer);
  void associatedTasks(observer);
  if (current(observer)) void live(observer);
}
function pauseLogs(observer: Observer): void {
  observer.logGeneration++;
  observer.logState = "paused";
  observer.logController?.abort();
}
async function loadLogs(observer: Observer, next = false): Promise<void> {
  if (!current(observer) || observer.logLoading) return;
  pauseLogs(observer);
  const generation = observer.logGeneration;
  observer.logLoading = true;
  try {
    const page = await api.request<RunLogPage>(
      observer.endpoint,
      `/runs/${observer.id}/logs?afterSequence=${next ? observer.logs.sequence : 0}${observer.logs.limits ? `&limit=${Math.min(50, observer.logs.limits.pageSize)}` : ""}`,
      { signal: observer.controller.signal },
    );
    if (!current(observer) || generation !== observer.logGeneration) return;
    observer.logs.accept(page, true);
    observer.logError = "";
    if (!next) void followLogs(observer);
  } catch (error) {
    if (!current(observer) || generation !== observer.logGeneration) return;
    observer.logError =
      error instanceof ApiError && error.code === "unsupported_version"
        ? `此服务不支持 Run Logs 接口：${error.message}`
        : `日志加载失败：${String(error)}`;
    observer.logState = "disconnected";
  } finally {
    observer.logLoading = false;
    if (current(observer)) renderObserver(observer);
  }
}
async function followLogs(observer: Observer): Promise<void> {
  observer.logGeneration++;
  observer.logController?.abort();
  const controller = new AbortController();
  observer.logController = controller;
  const abort = () => controller.abort();
  observer.controller.signal.addEventListener("abort", abort, { once: true });
  const valid = () =>
    current(observer) && !controller.signal.aborted && observer.logController === controller;
  let failures = 0;
  try {
    while (valid() && failures < 5) {
      try {
        observer.logState = "following";
        renderObserver(observer);
        const response = await fetch(
          api.path(
            observer.endpoint,
            `/runs/${observer.id}/logs/events?limit=${Math.min(50, observer.logs.limits?.pageSize ?? 50)}&afterSequence=${observer.logs.sequence}`,
          ),
          { headers: api.headers(observer.endpoint), signal: controller.signal },
        );
        if (!response.ok) await api.decode(response);
        await consumeRunLogSse(response, (page) => {
          if (!valid()) return;
          observer.logs.accept(page);
          observer.logError = "";
          observer.logState = "following";
          failures = 0;
          renderObserver(observer);
          const viewport = document.querySelector<HTMLElement>(
            `[data-run-log-viewport="${observer.id}"]`,
          );
          if (viewport) viewport.scrollTop = viewport.scrollHeight;
        });
        if (!valid()) return;
        if (
          observer.logs.state?.completeness !== "open" ||
          ["unsupported", "disabled", "expired"].includes(observer.logs.state?.availability ?? "")
        ) {
          observer.logState = "ended";
          renderObserver(observer);
          return;
        }
        observer.logError = "日志流已断开，按最后确认序号续接。";
      } catch (error) {
        if (!valid()) return;
        observer.logError = `日志流中断：${String(error)}。可重新连接补读。`;
        if (error instanceof ApiError && [400, 401, 403, 404, 410, 503].includes(error.status))
          failures = 5;
        else failures++;
      }
      observer.logState = "disconnected";
      renderObserver(observer);
      if (failures < 5)
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", finish);
            resolve();
          };
          const timer = setTimeout(finish, 1000);
          controller.signal.addEventListener("abort", finish, { once: true });
          if (controller.signal.aborted) finish();
        });
    }
  } finally {
    observer.controller.signal.removeEventListener("abort", abort);
  }
}
function logPanel(observer: Observer): HTMLElement {
  const panel = node("section");
  panel.className = "run-logs";
  panel.dataset.key = `logs:${observer.id}`;
  panel.setAttribute("aria-label", `Run ${observer.id} Logs`);
  panel.append(node("h3", "Logs · 诊断日志"), node("code", observer.id));
  const toolbar = node("div");
  toolbar.className = "run-log-toolbar";
  toolbar.append(
    button(
      "暂停日志跟随",
      () => {
        pauseLogs(observer);
        renderObserver(observer);
      },
      observer.logState !== "following",
    ),
    button(
      "跟随 / 重新连接日志",
      () => followLogs(observer),
      observer.logState === "following" || observer.logLoading,
    ),
    button("从头读取日志", () => loadLogs(observer), observer.logLoading),
    button(
      "下一页日志",
      () => loadLogs(observer, true),
      !observer.logs.hasMore || observer.logLoading,
    ),
  );
  panel.append(toolbar);
  const state = observer.logs.state;
  const names = {
    available: "日志可用",
    unsupported: "此 Bundle 协议不支持日志",
    disabled: "宿主已禁用日志",
    truncated: "日志已截断 / 输出超限",
    expired: "日志已过期或被容量清理",
    unavailable: "日志存储不可用",
  };
  const status = node(
    "p",
    `${state ? names[state.availability] : "正在读取日志"}；${({ loading: "读取中", following: "实时跟随", paused: "跟随已暂停", disconnected: "已断连", ended: "跟随结束" } as const)[observer.logState]}`,
  );
  status.setAttribute("role", "status");
  panel.append(status);
  if (state)
    panel.append(
      node(
        "p",
        `已丢弃 ${state.dropped} 条；尾部${({ open: "尚未结束", complete: "已确认", unknown: "完整性未知（成功/取消不保证日志完整）" } as const)[state.completeness]}${state.reason ? `；${state.reason}` : ""}`,
      ),
    );
  if (observer.logs.limits) {
    const limits = observer.logs.limits;
    panel.append(
      node(
        "p",
        `宿主限额：单条 ${limits.entryBytes} 字节；每 Run ${limits.runEntries} 条 / ${limits.runBytes} 字节；全局 ${limits.totalBytes} 字节；保留 ${limits.retentionMs} 毫秒。`,
      ),
    );
  }
  report(`Run:${observer.id} / 日志`, observer.logError, observer.endpoint);
  if (observer.logs.gap)
    panel.append(node("p", "日志游标存在缺口，不能保证完整。已保留可读取内容。"));
  if (observer.logs.trimmed)
    panel.append(node("p", "浏览器窗口已按 300 条 / 1 MiB 清理；使用历史分页查看较早日志。"));
  if (!observer.logs.entries.length && state?.availability === "available")
    panel.append(node("p", "此 Run 尚未输出诊断日志。"));
  const viewport = node("div");
  viewport.dataset.runLogViewport = observer.id;
  viewport.dataset.key = `log-viewport:${observer.id}`;
  viewport.className = "run-log-viewport";
  viewport.tabIndex = 0;
  for (const entry of observer.logs.entries) {
    const row = node("article");
    row.className = `run-log-entry run-log-${entry.level}`;
    row.dataset.key = `log:${observer.id}:${entry.sequence}`;
    row.append(
      node("small", `#${entry.sequence}  ${entry.receivedAt}  ${entry.level}`),
      node("pre", entry.message),
    );
    if (entry.fields)
      row.append(details("结构化字段", entry.fields, `log-fields:${entry.sequence}`));
    viewport.append(row);
  }
  panel.append(viewport);
  return panel;
}
async function refreshRun(observer: Observer): Promise<void> {
  if (!current(observer) || observer.kind !== "runId") return;
  try {
    const snapshot = await api.request<RunSnapshot>(observer.endpoint, `/runs/${observer.id}`, {
      signal: observer.controller.signal,
    });
    if (!validRunSnapshot(snapshot) || snapshot.runId !== observer.id)
      throw new Error("Run 快照协议无效。");
    if (!current(observer)) return;
    if (sourcePosition(snapshot.revision).position < observer.sourceWatermark) return;
    const previous = observer.runSnapshot;
    if (
      previous &&
      (previous.dataDomain !== snapshot.dataDomain ||
        sourcePosition(previous.revision).position > sourcePosition(snapshot.revision).position)
    )
      return;
    observer.runSnapshot = snapshot;
    observer.sourceWatermark = sourcePosition(snapshot.revision).position;
    observer.executionState = snapshot.stage;
    observer.reclaimed = !!snapshot.reclaimedAt;
    observer.end.run(snapshot);
    observer.window.streamCursor ??= snapshot.revision;
    observer.detailError = "";
    if (observer.end.ended) stopStream(observer, "ended");
  } catch (error) {
    if (current(observer)) observer.detailError = String(error);
  }
  if (current(observer)) renderObserver(observer);
}
function eventList(key: string, title: string, events: PublicEvent[]): HTMLElement {
  const group = node("details");
  group.dataset.key = key;
  group.append(node("summary", `${title}（${events.length}）`));
  for (const event of events)
    group.append(
      details(
        `#${event.sequence} ${event.type} · ${event.occurredAt}`,
        event,
        `event:${eventKey(event)}`,
      ),
    );
  return group;
}
function renderObserver(observer: Observer): void {
  if (!current(observer)) return;
  const container = observer.kind === "taskId" ? "task-detail" : "execution-detail";
  const box = node("div");
  box.dataset.key = `${observer.endpoint.binding}:${observer.kind}:${observer.id}`;
  const observationState = node(
    "p",
    `${({ idle: "正在读取", live: "实时更新", stale: "观察陈旧 / 已断开，详见错误日志", paused: "观察已暂停", ended: "观察已结束" } as const)[observer.streamState]}${observer.window.lastReceived ? ` · 最后读取 ${observer.window.lastReceived}` : ""}`,
  );
  observationState.className = "observation-state";
  box.append(observationState);
  const refresh = inlineButton("重新观察", () =>
    observer.kind === "taskId" ? openTask(observer.id) : openRun(observer.id),
  );
  refresh.dataset.action = "refresh";
  box.append(
    refresh,
    inlineButton(
      "暂停观察",
      () => {
        stopStream(observer, "paused");
        renderObserver(observer);
      },
      observer.streamState === "paused" || observer.streamState === "ended",
    ),
  );
  for (const [source, error] of [
    ["详情", observer.detailError],
    ["原请求", observer.requestError],
    ["历史", observer.historyError],
    ["事件流", observer.message],
    ["历史缺口", observer.window.gap],
  ] as const)
    report(`${observer.kind}:${observer.id} / ${source}`, error ?? "", observer.endpoint);
  if (observer.detailError || observer.requestError || observer.historyError || observer.window.gap)
    box.append(node("p", "部分信息不可用或存在缺口，详见错误日志。"));
  if (!observer.window.historyLoaded) box.append(node("p", "未读取到历史，实时流不代表完整历史。"));
  if (observer.window.truncated)
    box.append(
      node(
        "p",
        "实时窗口已按 500 条 / 2 MiB 清理；可用历史仍可逐页读取。过滤后的 sequence 跳号不等于缺口。",
      ),
    );
  if (observer.kind === "taskId") {
    if (observer.template && !observer.snapshot) {
      box.append(
        node("p", "本机保存的完整参数模板，不是服务端任务快照。"),
        details("保存的完整原参数", observer.template.parameters),
      );
      box.append(
        button("用保存参数直接新建", () =>
          reuse(observer.endpoint, observer.template!.parameters as Parameters, true),
        ),
        inlineButton("编辑保存参数", () =>
          reuse(observer.endpoint, observer.template!.parameters as Parameters, false),
        ),
        starButton(observer.endpoint, observer.id),
      );
    }
    const task = observer.snapshot;
    if (task) {
      if (task.bundle) box.append(bundleReference(task.bundle), copyCid(bundleCid(task.bundle)));
      const now = Date.now();
      const timeout = now > Date.parse(task.deadlineAt);
      const state = node("p", taskStatus(task, now));
      state.className = "status";
      box.append(state);
      const explanation = taskStatusExplanation(task, now);
      if (explanation) box.append(node("p", explanation));
      box.append(
        node(
          "p",
          `截止时间：${task.deadlineAt}${task.canceledAt ? ` · 取消于 ${task.canceledAt}` : ""}${timeout ? " · 当前已过截止时间，不代表结果逾期" : ""}`,
        ),
      );
      if (task.termination && !observer.end.ended)
        box.append(
          node(
            "p",
            `Run 已形成结局；${task.canceled ? "Task 需求已撤回" : "Task 仍可撤回需求"}，可继续观察控制变化。资源回收请查看关联 Run。`,
          ),
        );
      else if (task.canceledAt && !observer.end.ended)
        box.append(
          node(
            "p",
            "Task 需求已撤回，不代表关联 Run 已退出；继续观察其 stage，资源回收请查看关联 Run。",
          ),
        );
      box.append(starButton(observer.endpoint, task.taskId));
      box.append(
        details("Task 与完整 Run 标识", {
          taskId: task.taskId,
          requestId: task.requestId,
          receivedAt: task.receivedAt,
          run: task.run,
        }),
      );
      if (task.run)
        box.append(button(`关联 Run ${task.run.runId}`, () => openRun(task.run!.runId)));
      const cancel = button(
        "取消选中的 Task",
        async () => {
          if (!current(observer)) return;
          const accept = workspace(observer.endpoint).tasks.beginCancellation(observer.id);
          const snapshot = await api.request<TaskSnapshot>(
            observer.endpoint,
            `/tasks/${observer.id}/cancel`,
            { method: "POST" },
          );
          if (!validSnapshot(snapshot) || snapshot.taskId !== observer.id)
            throw new Error("取消回执无效；结果未知，请刷新原 Task 核对，不代表已回收 Run。");
          if (!current(observer)) return;
          accept(snapshot);
          observer.snapshot =
            workspace(observer.endpoint).tasks.values.get(observer.id) ?? snapshot;
          inform("取消回执已收到；关联 Run 是否回收请看其事件。");
          updateFacts(observer, []);
          renderTasks();
          renderObserver(observer);
        },
        !!task.canceledAt,
      );
      cancel.dataset.action = "cancel";
      box.append(cancel, details("原始 Task 快照", task, "task-snapshot"));
      if (task.result !== undefined) box.append(details("任务结果", task.result, "task-result"));
      report(
        `Task:${observer.id} / 系统故障`,
        task.error ? `${task.error.code}: ${task.error.message}` : "",
        observer.endpoint,
      );
      if (task.error) box.append(details("系统故障事实", task.error));
      if (observer.request) {
        box.append(details("原始请求（GET /requests）", observer.request));
        box.append(
          inlineButton("原参数直接重做（新身份）", () =>
            reuse(observer.endpoint, originalParameters(observer.request!), true),
          ),
        );
        box.append(
          inlineButton("编辑后重做", () =>
            reuse(observer.endpoint, originalParameters(observer.request!), false),
          ),
        );
      } else box.append(node("p", "原请求尚不可读；不提供空参数重做。"));
    }
  } else {
    const events = observer.window.events;
    const state = node(
      "p",
      `${
        (
          {
            unknown: "Run 状态尚未取得",
            running: "尝试中",
            stopping: "正在停止",
            stopped: "已停止",
            completed: "已完成",
            failed: "Run 失败",
          } as const
        )[observer.executionState]
      }${observer.reclaimed ? " · 已回收" : " · 回收未确认"}`,
    );
    state.className = "status";
    box.append(state, details("Run 标识", { runId: observer.id }));
    const snapshot = observer.runSnapshot;
    if (snapshot) {
      if (snapshot.bundle)
        box.append(node("code", bundleCid(snapshot.bundle)), copyCid(bundleCid(snapshot.bundle)));
      box.append(details("原始 Run 快照", snapshot, "run-snapshot"));
      if (snapshot.progress !== undefined)
        box.append(details("Run 进展（不代表完成）", snapshot.progress, "run-progress"));
      if (snapshot.outcome !== undefined)
        box.append(details("类型结果报告（不代表退出或回收）", snapshot.outcome, "run-outcome"));
      if (snapshot.result !== undefined)
        box.append(details("Run 结果", snapshot.result, "run-result"));
      report(
        `Run:${observer.id} / 系统故障`,
        snapshot.error ? `${snapshot.error.code}: ${snapshot.error.message}` : "",
        observer.endpoint,
      );
      if (snapshot.error !== undefined)
        box.append(details("Run 故障事实", snapshot.error, "run-error"));
      if (snapshot.stopRequested !== undefined)
        box.append(details("停止请求（不代表已停止）", snapshot.stopRequested, "run-stop-request"));
      if (snapshot.exit !== undefined)
        box.append(details("退出/恢复裁决事实", snapshot.exit, "run-exit"));
      if (snapshot.cleanupUnknown !== undefined) {
        const warning = node("p", "资源清理未确认；不能据此认定资源已释放。");
        warning.dataset.key = "run-cleanup-warning";
        box.append(
          warning,
          details("清理未知证据", snapshot.cleanupUnknown, "run-cleanup-unknown"),
        );
      }
    } else box.append(node("p", "未取得 Run 快照；目录摘要和事件不替代完整诊断事实。"));
    report(`Run:${observer.id} / 关联任务`, observer.associated.error, observer.endpoint);
    if (observer.associated.error) box.append(node("p", "关联任务不可读，详见错误日志。"));
    if (observer.associated.page)
      box.append(
        node(
          "p",
          `可读关联任务：已加载 ${observer.associated.page.tasks.length} 条（不是全体 owner 统计） · ${directoryObservation(observer.associated)}`,
        ),
      );
    for (const task of observer.associated.page?.tasks ?? []) {
      const link = button(`${task.type} · ${taskStatus(task)} →`, () => openTask(task.taskId));
      link.title = taskStatusExplanation(task);
      box.append(link);
    }
    if (observer.associated.page?.next)
      box.append(
        button("更多关联任务", () => associatedTasks(observer, true), observer.associated.expired),
      );
    box.append(
      button("查看此执行的任务", () => {
        workspace().associatedExecutionId = observer.id;
        (get("only-favorites") as HTMLInputElement).checked = false;
        navigation.show("tasks", false);
        void queryDirectory();
      }),
    );
    const dates: Record<string, string | undefined> = {
      "run.started": observer.runSnapshot?.startedAt ?? observer.executionSummary?.startedAt,
      "run.outcome": observer.runSnapshot?.outcome?.occurredAt,
      "run.completed": observer.runSnapshot?.completedAt ?? observer.executionSummary?.completedAt,
      "run.failed": observer.runSnapshot?.failedAt ?? observer.executionSummary?.failedAt,
      "run.exited": observer.runSnapshot?.exit?.occurredAt ?? observer.executionSummary?.stoppedAt,
      "run.reclaimed": observer.runSnapshot?.reclaimedAt ?? observer.executionSummary?.reclaimedAt,
    };
    for (const [kind, label] of [
      ["run.started", "开始"],
      ["run.outcome", "类型结果报告（不代表退出或回收）"],
      ["run.completed", "完成"],
      ["run.failed", "执行故障"],
      ["run.exited", "退出/恢复裁决"],
      ["run.reclaimed", "回收"],
    ] as const) {
      const event = events.find((item) => item.type === kind);
      const fromSummary = dates[kind];
      const source = observer.runSnapshot ? "Run 快照" : "目录摘要";
      box.append(
        node(
          "p",
          `${label}：${event ? event.occurredAt : fromSummary ? `${fromSummary}（${source}）` : "当前窗口未取得证据（不等于未发生）"}`,
        ),
      );
    }
  }
  const ownEvents = observer.window.events.filter((event) =>
    observer.kind === "taskId" ? !event.type.startsWith("run.") : event.type.startsWith("run."),
  );
  if (observer.kind === "runId") box.append(logPanel(observer));
  box.append(eventList("own-events", "对象事件 · 最近窗口", ownEvents));
  box.append(
    eventList("all-events", "全部公开事件 · 最近窗口（含关联对象）", observer.window.events),
  );
  box.append(eventList("history-events", "当前历史页 · 全部公开载荷", observer.historyEvents));
  box.append(inlineButton("重新读取事件历史", () => history(observer), observer.loading));
  const more = button(
    "下一页事件历史",
    () => history(observer, true),
    !observer.window.historyNext || observer.loading,
  );
  more.dataset.action = "history-next";
  box.append(more);
  reconcile(container, [box]);
}
function directoryQuery(): string {
  const query = new URLSearchParams({ sort: "created-desc" });
  const type = (get("history-type") as HTMLInputElement).value;
  if (type.length > 256) throw new Error("类型筛选最多 256 字符。");
  if (type) query.set("bundleCid", type);
  if (selection.endpoint && workspace().associatedExecutionId)
    query.set("runId", workspace().associatedExecutionId);
  for (const [id, key] of [
    ["created-from", "createdFrom"],
    ["created-before", "createdBefore"],
  ] as const) {
    const value = (get(id) as HTMLInputElement).value;
    if (value) {
      validateTime(value);
      query.set(key, value);
    }
  }
  validateRange(query.get("createdFrom"), query.get("createdBefore"));
  return query.toString();
}
function validateTime(value: string): void {
  const local = `${value.slice(0, 19)}Z`;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    !Number.isFinite(Date.parse(local)) ||
    new Date(local).toISOString().slice(0, 10) !== value.slice(0, 10) ||
    Number(value.slice(11, 13)) > 23 ||
    (value.at(-1) !== "Z" && (Number(value.slice(-5, -3)) > 23 || Number(value.slice(-2)) > 59))
  )
    throw new Error("请输入真实日期和明确时区，例如 2026-10-31T00:00:00+08:00。");
}
function validateRange(from: string | null, before: string | null): void {
  if (from && before && Date.parse(from) >= Date.parse(before))
    throw new Error("时间下界必须早于上界（含下界、不含上界）。");
}
async function queryDirectory(append = false): Promise<void> {
  if (selection.endpoint) {
    workspace().taskCollection?.abort();
    delete workspace().taskCollection;
    workspace().directory.live = false;
    workspace().directory.polling = false;
  }
  if ((get("only-favorites") as HTMLInputElement).checked) {
    renderDirectory();
    try {
      directoryQuery();
      await checkStarSources();
    } catch (error) {
      notify(error);
    }
    if (!selection.endpoint) {
      renderDirectory();
      return;
    }
    return;
  }
  const state = workspace();
  const lease = selection.capture();
  let started = false;
  try {
    const query = append ? state.directory.query : directoryQuery();
    started = true;
    const accepted = await state.directory.load(
      (query) => api.request(state.endpoint, `/tasks?${query}`, { signal: lease.signal }),
      query,
      append,
      lease.current,
    );
    if (!accepted) return;
    void monitorDirectory(state, "tasks", lease);
  } catch (error) {
    if (!started && lease.current()) state.directory.rejectQuery(error);
  }
  if (lease.current()) renderDirectory();
}
async function monitorDirectory(
  state: Workspace,
  kind: "tasks" | "runs",
  lease: ReturnType<Selection["capture"]>,
): Promise<void> {
  const directory = kind === "tasks" ? state.directory : state.executionDirectory;
  const controller = new AbortController();
  if (kind === "tasks") {
    state.taskCollection?.abort();
    state.taskCollection = controller;
  } else {
    state.runCollection?.abort();
    state.runCollection = controller;
  }
  const active = () =>
    lease.current() &&
    !controller.signal.aborted &&
    (kind === "tasks" ? state.taskCollection : state.runCollection) === controller;
  const render = () => {
    if (active()) kind === "tasks" ? renderDirectory() : renderExecutions();
  };
  await observeCollection<TaskPage | RunPage>(
    directory,
    state.endpoint,
    kind,
    controller,
    lease.signal,
    active,
    render,
    () =>
      !navigation.overlay &&
      directoryRefreshAllowed(kind === "tasks" ? "directory" : "execution-directory"),
  );
}
function directoryRefreshAllowed(id: string): boolean {
  const focused = document.activeElement;
  return (
    !document.hidden &&
    !(focused?.closest("table") && get(id).contains(focused)) &&
    window.getSelection()?.isCollapsed !== false
  );
}
function waitDirectoryRefresh(signal: AbortSignal, milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      document.removeEventListener("visibilitychange", visibility);
      resolve();
    };
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) finish();
    };
    signal.addEventListener("abort", finish, { once: true });
    document.addEventListener("visibilitychange", visibility);
    if (signal.aborted) finish();
    else if (!document.hidden) timer = setTimeout(finish, milliseconds);
  });
}
async function observeCollection<P extends TaskPage | RunPage>(
  directory: Directory<P>,
  endpoint: Endpoint,
  kind: "tasks" | "runs",
  controller: AbortController,
  parent: AbortSignal,
  current: () => boolean,
  render: () => void,
  canRefresh: () => boolean,
  errorSource = kind === "tasks" ? "任务目录" : "Run 目录",
): Promise<void> {
  const abort = () => controller.abort();
  parent.addEventListener("abort", abort, { once: true });
  if (parent.aborted) abort();
  try {
    await observeDirectory({
      directory,
      signal: controller.signal,
      current,
      canRefresh,
      wait: (milliseconds) => waitDirectoryRefresh(controller.signal, milliseconds),
      fetchPage: (query) =>
        api.request<P>(endpoint, `/${kind}?${query}`, { signal: controller.signal }),
      stream: async (from, receive) => {
        const query = new URLSearchParams(directory.query);
        query.set("fromRevision", from);
        const response = await fetch(api.path(endpoint, `/${kind}/events?${query}`), {
          headers: api.headers(endpoint),
          signal: controller.signal,
        });
        if (!response.ok) await api.decode(response);
        if (!current() || controller.signal.aborted) return;
        directory.live = true;
        directory.error = "";
        directory.stale = false;
        render();
        await consumeCollectionSse(response, receive);
      },
      changed: render,
      failed: (message) => report(errorSource, message, endpoint, true),
    });
  } finally {
    parent.removeEventListener("abort", abort);
  }
}
function directoryObservation(directory: Directory<TaskPage | RunPage>): string {
  if (directory.live) return "完整实时集合";
  if (directory.polling)
    return `分页近实时（5 秒采样）${document.hidden ? " · 页面隐藏，采样暂停" : ""}${directory.stale ? " · 数据陈旧，详见错误日志" : ""}`;
  return directory.stale
    ? "上次确认快照 · 数据陈旧"
    : directory.page?.next
      ? "分页快照 · 自动采样已暂停"
      : "完整快照";
}
function renderDirectory(): void {
  const contents = node("div");
  contents.dataset.key = "task-directory";
  const rows: DirectoryRowDescription[] = [];
  const show = (more?: HTMLButtonElement) =>
    view.directory(
      "tasks",
      {
        rows,
        scope: `${selection.endpoint?.id ?? ""}:${selection.endpoint?.binding ?? ""}`,
        query: selection.endpoint ? workspace().directory.query : "",
        complete:
          !!selection.endpoint && !!workspace().directory.page && !workspace().directory.page?.next,
        more,
      },
      [contents],
    );
  if (!selection.endpoint) {
    if ((get("only-favorites") as HTMLInputElement).checked) renderStars(contents);
    else {
      contents.append(node("p", "未配置服务；可以切换“只看收藏”查看本机保存的模板。"));
      show();
    }
    return;
  }
  const association = node("div");
  if (workspace().associatedExecutionId)
    association.append(
      node("span", `执行关联筛选：${workspace().associatedExecutionId.slice(-8)}`),
      button("清除关联筛选", () => {
        workspace().associatedExecutionId = "";
        return queryDirectory();
      }),
    );
  view.render("association-filter", [...association.childNodes]);
  if ((get("only-favorites") as HTMLInputElement).checked) {
    renderStars(contents);
    return;
  }
  const state = workspace();
  const directory = state.directory;
  report("任务目录", directory.error);
  if (!directory.page) {
    contents.append(node("p", "尚未取得任务目录。目录查询与提交、Request 跟踪相互独立。"));
    show();
    return;
  }
  contents.append(
    node(
      "p",
      `已加载 ${directory.page.tasks.length} 条 · ${directoryObservation(directory)} · 水位 ${directory.page.revision} · 基线 ${directory.page.observedAt}`,
    ),
  );
  if (directory.dropped)
    contents.append(
      node(
        "p",
        `已释放前 ${directory.dropped} 条本机摘要，仅保留最近 1000 条已加载记录；目录游标仍属于原快照。重新查询可从头查看。`,
      ),
    );
  for (const task of directory.page.tasks) {
    const row = node("tr");
    row.dataset.key = `task:${state.endpoint.binding}:${task.taskId}`;
    describeRowAction(row, {
      kind: "task",
      id: task.taskId,
      label: `查看任务 ${task.name ?? task.type} · ${task.taskId.slice(-8)} 的详情`,
      run: () => openTask(task.taskId),
      error: notify,
    });
    const star = node("td");
    star.dataset.rowControls = "";
    star.append(starButton(state.endpoint, task.taskId));
    const title = node("td");
    const type = node("span", task.name ?? task.type);
    type.className = "entity-type";
    title.append(type, node("small", task.taskId.slice(-8)));
    if (task.bundle) title.append(compactBundle(bundleCid(task.bundle)));
    row.append(star, title);
    const status = node("td", taskStatus(task));
    status.title = taskStatusExplanation(task);
    const actions = node("td");
    actions.dataset.rowControls = "";
    const redo = async (direct: boolean) => {
      const endpoint = state.endpoint;
      const original = await api.request<Record<string, unknown>>(
        endpoint,
        `/requests/${task.requestId}`,
      );
      if (!selection.endpoint || !endpointMatches(endpoint, selection.endpoint)) return;
      await reuse(endpoint, originalParameters(original), direct);
    };
    actions.append(
      inlineButton("重做", () => redo(true)),
      inlineButton("编辑重做", () => redo(false)),
    );
    row.append(status, node("td", new Date(task.receivedAt).toLocaleString()), actions);
    rows.push({
      id: row.dataset.key,
      title: `${task.name ?? task.type} ${task.taskId}`,
      status: taskStatus(task),
      time: Date.parse(task.receivedAt),
      node: row,
    });
  }
  if (!directory.page.tasks.length) contents.append(node("p", "没有符合筛选的任务。"));
  show(
    button(
      "目录下一页（原过滤条件）",
      () => queryDirectory(true),
      !directory.page.next || directory.expired,
    ),
  );
}
async function associatedTasks(observer: Observer, append = false): Promise<void> {
  observer.associatedController?.abort();
  const controller = new AbortController();
  observer.associatedController = controller;
  const active = () =>
    current(observer) && observer.associatedController === controller && !controller.signal.aborted;
  try {
    const accepted = await observer.associated.load(
      (query) =>
        api.request(observer.endpoint, `/tasks?${query}`, { signal: observer.controller.signal }),
      new URLSearchParams({ runId: observer.id, sort: "created-desc" }).toString(),
      append,
      active,
    );
    if (accepted)
      void observeCollection(
        observer.associated,
        observer.endpoint,
        "tasks",
        controller,
        observer.controller.signal,
        active,
        () => {
          if (active()) renderObserver(observer);
        },
        () => directoryRefreshAllowed("execution-detail"),
        `Run:${observer.id} / 关联任务`,
      );
  } catch {
    /* The directory retains its explicit error, independently from event permissions. */
  }
  if (current(observer)) renderObserver(observer);
}
async function queryExecutions(append = false): Promise<void> {
  const state = workspace(),
    lease = selection.capture();
  let started = false;
  state.runCollection?.abort();
  delete state.runCollection;
  state.executionDirectory.live = false;
  state.executionDirectory.polling = false;
  try {
    let query = state.executionDirectory.query;
    if (!append) {
      const filters = new URLSearchParams({ sort: "started-desc" });
      const type = (get("execution-type") as HTMLInputElement).value;
      if (type.length > 256) throw new Error("类型筛选最多 256 字符。");
      if (type) filters.set("bundleCid", type);
      for (const [id, key] of [
        ["started-from", "startedFrom"],
        ["started-before", "startedBefore"],
      ] as const) {
        const value = (get(id) as HTMLInputElement).value;
        if (value) {
          validateTime(value);
          filters.set(key, value);
        }
      }
      validateRange(filters.get("startedFrom"), filters.get("startedBefore"));
      query = filters.toString();
    }
    started = true;
    const accepted = await state.executionDirectory.load(
      (query) => api.request(state.endpoint, `/runs?${query}`, { signal: lease.signal }),
      query,
      append,
      lease.current,
    );
    if (!accepted) return;
    void monitorDirectory(state, "runs", lease);
  } catch (error) {
    if (!started && lease.current()) state.executionDirectory.rejectQuery(error);
  }
  if (lease.current()) renderExecutions();
}
function renderExecutions(): void {
  const box = node("div");
  const directory = workspace().executionDirectory;
  const rows: DirectoryRowDescription[] = [];
  let more: HTMLButtonElement | undefined;
  box.dataset.key = "execution-directory";
  report("Run 目录", directory.error);
  if (directory.page) {
    box.append(
      node(
        "p",
        `已加载 ${directory.page.runs.length} 个 Run · ${directoryObservation(directory)} · 水位 ${directory.page.revision} · 基线 ${directory.page.observedAt}`,
      ),
    );
    if (directory.dropped)
      box.append(node("p", `前 ${directory.dropped} 条本机摘要已释放；重新查询可从头查看。`));
    for (const execution of directory.page.runs) {
      const row = node("tr"),
        title = node("td");
      row.dataset.key = `run:${execution.runId}`;
      describeRowAction(row, {
        kind: "run",
        id: execution.runId,
        label: `查看 Run ${execution.name ?? execution.type} · ${execution.runId.slice(-8)} 的详情`,
        run: () => openRun(execution.runId),
        error: notify,
      });
      const type = node("span", execution.name ?? execution.type);
      type.className = "entity-type";
      title.append(type, node("small", execution.runId.slice(-8)));
      if (execution.bundle) title.append(compactBundle(bundleCid(execution.bundle)));
      const status = `${execution.state.completed ? "已完成" : execution.state.failed ? "执行失败" : execution.state.running ? "执行中" : "结果未确认"}${execution.state.reclaimed ? " · 已回收" : " · 未确认回收"}`;
      row.append(
        title,
        node("td", status),
        node("td", new Date(execution.startedAt).toLocaleString()),
      );
      rows.push({
        id: row.dataset.key,
        title: `${execution.name ?? execution.type} ${execution.runId}`,
        status,
        time: Date.parse(execution.startedAt),
        node: row,
      });
    }
    if (!directory.page.runs.length) box.append(node("p", "没有符合筛选的 Run 记录。"));
    more = button(
      "执行目录下一页",
      () => queryExecutions(true),
      !directory.page.next || directory.expired,
    );
  } else
    box.append(
      node("p", directory.error ? "执行目录不可用，详见错误日志。" : "尚未取得执行目录。"),
    );
  view.directory(
    "runs",
    {
      rows,
      scope: `${selection.endpoint?.id ?? ""}:${selection.endpoint?.binding ?? ""}`,
      query: directory.query,
      complete: !!directory.page && !directory.page.next,
      more,
    },
    [box],
  );
}
async function reuse(endpoint: Endpoint, parameters: Parameters, direct: boolean): Promise<void> {
  const configured = endpoints.find((item) => endpointMatches(item, endpoint));
  if (!configured) throw new Error("原 Endpoint 缺失或已重新绑定；阻止静默改投。");
  if (!selection.endpoint || !endpointMatches(selection.endpoint, endpoint))
    throw new Error(`请先明确切换到收藏/原请求目标 ${endpoint.label}，不会改投当前目标。`);
  const lease = selection.capture();
  if (direct) {
    const revision = bundleIdentity(parameters);
    const entry = await bar.quick(endpoint, parameters, revision);
    if (lease.current()) {
      inform(entry.message);
      if (entry.snapshot) {
        await openTask(entry.snapshot.taskId);
        void queryDirectory();
      }
    }
  } else {
    renderForm(structuredClone(parameters));
    if (!parameters.bundle)
      inform("旧模板未转换；请显式填写 Bundle 引用并检查业务 Input，原模板保持不变。");
    lastQuick = undefined;
    navigation.show("tasks", false);
    view.text("create-title", "编辑参数并新建任务");
    navigation.open("create-dialog");
  }
}
function starButton(endpoint: Endpoint, taskId: string): HTMLButtonElement {
  const saved = favorites.find(
    (item) => item.source?.taskId === taskId && endpointMatches(item.endpoint, endpoint),
  );
  const control = button(saved ? "★" : "☆", async () => {
    const lease = selection.capture();
    const accepted = saved
      ? await changeFavorites(`/api/favorites/${saved.id}`, "DELETE")
      : await changeFavorites("/api/favorites", "POST", { endpoint, taskId });
    if (!accepted || !lease.current()) return;
    inform(saved ? "已取消星标；不会取消任务。" : `已保存 ${endpoint.label} 的完整原参数。`);
  });
  control.className = "star";
  control.dataset.key = `star:${taskId}`;
  control.setAttribute("aria-label", saved ? "取消星标" : "标星任务");
  control.setAttribute("aria-pressed", String(!!saved));
  return control;
}
function selectedStars(): Favorite[] {
  const endpoint = selection.endpoint;
  return favorites.filter(
    (item) =>
      item.source &&
      (!endpoint ||
        item.endpoint.id === endpoint.id ||
        !endpoints.some((entry) => endpointMatches(entry, item.endpoint))),
  );
}
function renderStars(box: HTMLElement): void {
  const rows: DirectoryRowDescription[] = [];
  const show = () =>
    view.directory(
      "tasks",
      {
        rows,
        scope: `${selection.endpoint?.id ?? ""}:${selection.endpoint?.binding ?? ""}`,
        query: `favorites:${selection.endpoint ? workspace().directory.query : ""}`,
        complete: true,
      },
      [box],
    );
  let query: URLSearchParams;
  try {
    query = new URLSearchParams(directoryQuery());
    report("收藏筛选", "");
  } catch (error) {
    report("收藏筛选", String(error));
    show();
    return;
  }
  const stars = selectedStars().filter(
    (item) =>
      (!query.get("bundleCid") ||
        (item.parameters.bundle
          ? bundleIdentity(item.parameters as Parameters)
          : item.parameters.type) === query.get("bundleCid")) &&
      (!query.get("createdFrom") ||
        Date.parse(item.source!.receivedAt) >= Date.parse(query.get("createdFrom")!)) &&
      (!query.get("createdBefore") ||
        Date.parse(item.source!.receivedAt) < Date.parse(query.get("createdBefore")!)),
  );
  box.append(node("p", `本机星标 ${stars.length} 条 · 覆盖保存的全部星标，不限于目录当前页。`));
  for (const favorite of stars) {
    const row = node("tr");
    row.dataset.key = `favorite:${favorite.id}`;
    const available =
      !!selection.endpoint && endpointMatches(favorite.endpoint, selection.endpoint);
    const status = available
      ? (sourceStates.get(favorite.id)?.label ?? "来源尚未核对")
      : "原目标缺失或已重绑，禁止改投";
    if (available)
      describeRowAction(row, {
        kind: "task",
        id: favorite.source!.taskId,
        label: `查看收藏任务 ${favorite.name} 的详情`,
        run: () => openTask(favorite.source!.taskId),
        error: notify,
      });
    const star = node("td");
    star.dataset.rowControls = "";
    star.append(
      available
        ? starButton(favorite.endpoint, favorite.source!.taskId)
        : inlineButton("移除此本机星标", async () => {
            await changeFavorites(`/api/favorites/${favorite.id}`, "DELETE");
          }),
    );
    const title = node("td");
    const name = node("span", favorite.name);
    name.className = "entity-type";
    title.append(name, node("small", favorite.source!.taskId.slice(-8)));
    const actions = node("td");
    actions.dataset.rowControls = "";
    actions.append(
      inlineButton("查看来源 / 模板", () => openTask(favorite.source!.taskId), !available),
    );
    actions.append(
      button(
        "用保存参数新建",
        () => reuse(favorite.endpoint, favorite.parameters as Parameters, true),
        !available,
      ),
      inlineButton(
        "编辑后新建",
        () => reuse(favorite.endpoint, favorite.parameters as Parameters, false),
        !available,
      ),
    );
    actions.append(details("保存的完整原参数", favorite.parameters));
    row.append(
      star,
      title,
      node("td", `${status} · ${favorite.endpoint.label}`),
      node("td", new Date(favorite.source!.receivedAt).toLocaleString()),
      actions,
    );
    rows.push({
      id: row.dataset.key,
      title: `${favorite.name} ${favorite.source!.taskId}`,
      status,
      time: Date.parse(favorite.source!.receivedAt),
      node: row,
    });
  }
  if (!stars.length) box.append(node("p", "暂无符合筛选的星标任务。"));
  show();
}
let starChecks: AbortController | undefined;
async function checkStarSources(): Promise<void> {
  starChecks?.abort();
  if (!selection.endpoint) return;
  const control = new AbortController();
  starChecks = control;
  const lease = selection.capture();
  const abort = () => control.abort();
  lease.signal.addEventListener("abort", abort, { once: true });
  const items = selectedStars().filter((item) =>
    endpointMatches(item.endpoint, workspace().endpoint),
  );
  let index = 0;
  try {
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (index < items.length && !control.signal.aborted) {
          const item = items[index++]!;
          try {
            preserveSelectedCancellation(item.endpoint, item.source!.taskId);
            const tasks = workspace(item.endpoint).tasks;
            const accept = tasks.begin(item.source!.taskId);
            const value = await api.request<TaskSnapshot>(
              item.endpoint,
              `/tasks/${item.source!.taskId}`,
              { signal: control.signal },
            );
            if (!validSnapshot(value) || value.taskId !== item.source!.taskId)
              throw new Error("来源快照无效");
            if (control.signal.aborted || !lease.current()) return;
            preserveSelectedCancellation(item.endpoint, item.source!.taskId);
            accept(value);
            sourceStates.set(item.id, {
              label: `来源可用 · ${taskStatus(tasks.values.get(value.taskId) ?? value)}`,
            });
            report(`收藏:${item.id} / 来源`, "", item.endpoint);
          } catch (error) {
            if (control.signal.aborted || !lease.current()) return;
            sourceStates.set(item.id, {
              label:
                error instanceof ApiError && error.status === 404
                  ? "来源已清理 · 保存的模板仍可用"
                  : "来源不可访问，详见错误日志",
            });
            report(`收藏:${item.id} / 来源`, String(error), item.endpoint, true);
          }
          if ((get("only-favorites") as HTMLInputElement).checked) renderDirectory();
        }
      }),
    );
  } finally {
    lease.signal.removeEventListener("abort", abort);
  }
}
async function changeFavorites(
  path: string,
  method: "POST" | "DELETE",
  body?: unknown,
): Promise<boolean> {
  // Reads started before a write, or during it, cannot represent its acknowledged outcome.
  favoritesGeneration++;
  try {
    await api.local(path, method, body);
  } catch (error) {
    favoritesGeneration++;
    // A failed/uncertain write must not strand another successful write's invalidated refresh.
    try {
      await renderFavorites();
    } catch (refreshError) {
      throw new AggregateError(
        [error, refreshError],
        `修改失败且刷新失败，当前仅为上次确认数据。修改原因：${String(error)}；刷新原因：${String(refreshError)}`,
        { cause: error },
      );
    }
    throw error;
  }
  favoritesGeneration++;
  return renderFavorites();
}
async function renderFavorites(): Promise<boolean> {
  const generation = ++favoritesGeneration;
  const lease = selection.capture();
  const currentRead = () => generation === favoritesGeneration && lease.current();
  let next: Favorite[];
  try {
    next = await api.local<Favorite[]>("/api/favorites");
    if (!currentRead()) return false;
    if (!Array.isArray(next)) throw new Error("收藏列表协议无效，保留上次已确认数据。");
  } catch (error) {
    if (!currentRead()) return false;
    throw error;
  }
  favorites = next;
  const container = node("div");
  const legacy = favorites.filter((item) => !item.source);
  view.legacy = legacy.length > 0;
  for (const favorite of legacy) {
    const article = node("article");
    const configured = endpoints.find((endpoint) => endpointMatches(endpoint, favorite.endpoint));
    article.append(
      node("h3", favorite.name),
      node(
        "p",
        `目标：${favorite.endpoint.label} (${favorite.endpoint.id})${configured ? "" : " · 缺失或重新绑定，不能发送"}`,
      ),
    );
    article.append(details("完整原参数", favorite.parameters));
    if (configured && (!selection.endpoint || !endpointMatches(configured, selection.endpoint)))
      article.append(button("切换到原目标", () => chooseEndpoint(configured.id)));
    article.append(
      button(
        "套用旧模板",
        () => reuse(favorite.endpoint, favorite.parameters as Parameters, false),
        !configured,
      ),
    );
    article.append(
      button("删除此收藏", async () => {
        await changeFavorites(`/api/favorites/${favorite.id}`, "DELETE");
      }),
    );
    container.append(article);
  }
  view.render("favorites-list", [...container.childNodes]);
  renderDirectory();
  if (taskObserver && current(taskObserver)) renderObserver(taskObserver);
  return true;
}
async function chooseEndpoint(id: string): Promise<void> {
  const endpoint = endpoints.find((item) => item.id === id);
  if (!endpoint) throw new Error("Endpoint 不存在。");
  selection.select(endpoint);
  cacheGeneration++;
  cachePage = undefined;
  cacheDetail = undefined;
  cacheConfirm = undefined;
  cacheError = "";
  cacheBusy = false;
  const lease = selection.capture();
  starChecks?.abort();
  navigation.close("create-dialog", false);
  if (navigation.overlay) navigation.close(navigation.overlay.id, false);
  const cacheSelected = navigation.tab === "cache";
  navigation.show(cacheSelected ? "cache" : "tasks", false);
  (get("endpoint") as HTMLSelectElement).value = endpoint.id;
  closeObservers();
  formReader = undefined;
  formEndpoint = undefined;
  lastQuick = undefined;
  get("form-fields").replaceChildren();
  view.text("contract", "");
  view.render("contract-actions", []);
  view.text("discovery-status", `目标：${endpoint.label}。每次提交使用明确的 Bundle 引用。`);
  view.text("notice", `当前目标：${endpoint.label}。旧目标回执留在原分区；断流不会取消 Task。`);
  workspace().associatedExecutionId = "";
  (get("only-favorites") as HTMLInputElement).checked = false;
  for (const id of [
    "history-type",
    "created-from",
    "created-before",
    "execution-type",
    "started-from",
    "started-before",
  ])
    (get(id) as HTMLInputElement).value = "";
  renderBar();
  renderTasks();
  renderDirectory();
  renderExecutions();
  await Promise.all([initializeForm(), renderFavorites()]);
  if (lease.current()) {
    if (cacheSelected) await loadCache();
    else await queryDirectory();
  }
}
async function start(): Promise<void> {
  const unexpectedError = (event: ErrorEvent) => notify(event.error ?? event.message);
  const rejectedPromise = (event: PromiseRejectionEvent) => notify(event.reason);
  window.addEventListener("error", unexpectedError);
  window.addEventListener("unhandledrejection", rejectedPromise);
  const response = await fetch("/api/bootstrap");
  if (!response.ok) throw new Error(`UI 启动失败：${response.status}`);
  const bootstrap = (await response.json()) as { csrf: string; endpoints: Endpoint[] };
  api = new Api(bootstrap.csrf);
  endpoints = bootstrap.endpoints;
  view.text("bundle-cache", "请选择受控 Endpoint 后查看缓存。");
  view.events.tab = (tab) => {
    if (tab === "cache") void loadCache();
    if (tab === "executions" && selection.endpoint && !workspace().executionDirectory.page)
      void queryExecutions();
  };
  view.events.create = () => {
    view.text("create-title", "新建任务");
    view.text("dialog-notice", "");
    navigation.open("create-dialog");
  };
  view.events.favorites = () => {
    if (selection.endpoint) workspace().associatedExecutionId = "";
    starChecks?.abort();
    void queryDirectory().catch(notify);
  };
  view.endpoints = endpoints;
  view.events.endpoint = (id) => {
    void chooseEndpoint(id).catch(notify);
  };
  view.render("create-actions", [
    button(
      "提交任务",
      async () => {
        if (lastQuick && ["unknown", "preparing", "sending"].includes(lastQuick.state))
          throw new Error(
            "上一 Request 尚未完成受理确认；请在下方回执按原 requestId 跟踪，或明确“主动再做一次”。",
          );
        const form = checkedForm();
        const lease = selection.capture();
        // Capture before awaiting so a lost response never permits an accidental new identity.
        const batch = bar.create(form.endpoint);
        lastQuick = bar.add(batch, form.parameters, form.revision);
        const entry = lastQuick;
        await bar.sendBatch(batch);
        if (lease.current()) inform(entry.message);
        if (lease.current() && entry.snapshot) {
          void queryDirectory();
        }
      },
      false,
      300,
    ),
    button("加入批量", () => {
      const form = checkedForm();
      let batch = bar.batches.find(
        (item) =>
          endpointMatches(item.endpoint, form.endpoint) &&
          !item.sending &&
          item.entries.every((entry) => entry.state === "draft"),
      );
      batch ??= bar.create(form.endpoint);
      bar.add(batch, form.parameters, form.revision);
      inform("已加入批量，尚未提交；可继续填写下一条。");
    }),
  ]);
  view.render("history-actions", [button("重新查询", () => queryDirectory())]);
  view.render("execution-actions", [button("刷新执行目录", () => queryExecutions())]);
  const timeRefresh = setInterval(() => {
    if (!selection.endpoint) return;
    for (const batch of bar.batches)
      if (endpointMatches(batch.endpoint, selection.endpoint))
        for (const entry of batch.entries)
          if (entry.state === "preparing" || entry.state === "unknown") void bar.refresh(entry);
    renderTasks();
    if (!(get("only-favorites") as HTMLInputElement).checked) renderDirectory();
    if (taskObserver && current(taskObserver)) renderObserver(taskObserver);
  }, 1000);
  (timeRefresh as unknown as { unref?: () => void }).unref?.();
  const visibility = () => {
    if (!selection.endpoint) return;
    renderDirectory();
    renderExecutions();
    if (executionObserver && current(executionObserver)) renderObserver(executionObserver);
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", () => {
    window.removeEventListener("error", unexpectedError);
    window.removeEventListener("unhandledrejection", rejectedPromise);
    clearInterval(timeRefresh);
    document.removeEventListener("visibilitychange", visibility);
    for (const state of states.values()) {
      state.taskCollection?.abort();
      state.runCollection?.abort();
    }
    closeObservers();
    starChecks?.abort();
    view.dispose();
  });
  if (endpoints[0]) await chooseEndpoint(endpoints[0].id);
  else {
    await renderFavorites();
    (get("only-favorites") as HTMLInputElement).checked = true;
    renderDirectory();
    view.text("execution-directory", "未配置服务，执行目录不可用。");
    notify("没有配置 Endpoint；请由本机操作员配置并重启 UI。");
  }
}
void start().catch(notify);
