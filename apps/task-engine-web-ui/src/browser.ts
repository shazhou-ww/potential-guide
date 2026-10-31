import type {
  ExecutionPage,
  ExecutionSummary,
  HistoryPage,
  Observation,
  PublicEvent,
  TaskSnapshot,
  TaskSummary,
  TaskTypeDiscovery,
} from "@potential-guide/task-protocol";
import { claimActivation, reconcile } from "./dom.js";
import { envelopeKeys, envelopeSchema, schemaEditor } from "./form.js";
import { ObservationEnd, stages, taskStatus } from "./lifecycle.js";
import {
  Api,
  ApiError,
  consumeSse,
  Directory,
  discoveryRevision,
  type Entry,
  EventWindow,
  endpointMatches,
  originalParameters,
  type Parameters,
  Selection,
  SubmissionBar,
  TaskSnapshots,
  validSnapshot,
} from "./model.js";
import { Navigation } from "./navigation.js";
import type { Endpoint, Favorite } from "./server.js";

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}
function get(id: string): HTMLElement {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing UI element ${id}`);
  return result;
}
function button(
  text: string,
  action: () => void | Promise<void>,
  disabled = false,
  minimumInterval = 0,
): HTMLButtonElement {
  const result = node("button", text);
  result.type = "button";
  result.disabled = disabled;
  result.dataset.disabled = String(disabled);
  result.dataset.action = text;
  result.dataset.key = `action:${text}`;
  result.onclick = function () {
    const control = this as HTMLButtonElement;
    if (control.dataset.busy === "true" || !claimActivation(control, minimumInterval)) return;
    control.dataset.busy = "true";
    control.disabled = true;
    void Promise.resolve()
      .then(action)
      .catch(notify)
      .finally(() => {
        delete control.dataset.busy;
        control.disabled = control.dataset.disabled === "true";
      });
  };
  return result;
}
function details(title: string, value: unknown, key = title): HTMLDetailsElement {
  const result = node("details");
  result.dataset.key = key;
  result.append(node("summary", title), node("pre", JSON.stringify(value, null, 2)));
  return result;
}
function notify(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  get("notice").textContent = message;
  get("dialog-notice").textContent = message;
}
function focus(id: string): void {
  get(id).focus();
  get(id).scrollIntoView({ block: "start" });
}
function input(label: string, type = "text"): { label: HTMLLabelElement; input: HTMLInputElement } {
  const element = node("input");
  element.type = type;
  const wrapper = node("label", label);
  wrapper.append(element);
  return { label: wrapper, input: element };
}
const statusNames = {
  draft: "草稿",
  sending: "提交中",
  accepted: "已确认",
  failed: "被拒绝",
  unknown: "结果未知",
};
let api: Api;
let navigation: Navigation;
let endpoints: Endpoint[] = [];
let favorites: Favorite[] = [];
let favoritesGeneration = 0;
const sourceStates = new Map<string, { label: string }>();
const selection = new Selection();
const states = new Map<string, Workspace>();
let formReader: (() => Parameters) | undefined;
let formEndpoint: Endpoint | undefined;
let formRevision: string | undefined;
let formType = "";
let formBlocked = false;
let lastQuick: Entry | undefined;
interface Workspace {
  endpoint: Endpoint;
  types: TaskTypeDiscovery[];
  discoveryError: string;
  tasks: TaskSnapshots;
  directory: Directory;
  executionDirectory: Directory<ExecutionPage>;
  associatedExecutionId: string;
}
function workspace(endpoint = selection.endpoint): Workspace {
  if (!endpoint) throw new Error("请先配置并选择 Endpoint。");
  let state = states.get(endpoint.binding);
  if (!state) {
    state = {
      endpoint,
      types: [],
      discoveryError: "",
      tasks: new TaskSnapshots(),
      directory: new Directory(),
      executionDirectory: new Directory<ExecutionPage>("executions"),
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
    api.request(entry.endpoint, "/tasks", {
      method: "POST",
      body: entry.parameters,
      headers: { "Idempotency-Key": entry.id, "If-Match": `"${entry.revision}"` },
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
);
function checkedForm(): { endpoint: Endpoint; parameters: Parameters; revision: string } {
  if (
    !formReader ||
    !formEndpoint ||
    !formRevision ||
    formBlocked ||
    !selection.endpoint ||
    !endpointMatches(formEndpoint, selection.endpoint)
  )
    throw new Error("表单未绑定可用契约。请重新发现类型；原输入不会自动提交。");
  return { endpoint: formEndpoint, parameters: formReader(), revision: formRevision };
}
function renderForm(type: TaskTypeDiscovery, parameters?: Parameters): void {
  formReader = undefined;
  formBlocked = false;
  formEndpoint = workspace().endpoint;
  formRevision = type.revision;
  formType = type.type;
  const container = get("form-fields");
  container.replaceChildren();
  const original = parameters ?? { type: type.type };
  const envelope = Object.fromEntries(
    Object.entries(original).filter(([key]) => envelopeKeys.includes(key) && key !== "type"),
  );
  const business = Object.fromEntries(
    Object.entries(original).filter(([key]) => !envelopeKeys.includes(key)),
  );
  try {
    const common = schemaEditor(envelopeSchema, envelope, envelopeSchema, "请求参数");
    const fields = schemaEditor(type.inputSchema, business, type.inputSchema, `${type.type} 输入`);
    container.append(
      common.node,
      fields.node,
      details("Task 输入 Schema · 服务端进行完整校验", type.inputSchema),
    );
    formReader = () =>
      ({
        ...(common.read() as object),
        ...(fields.read() as object),
        type: type.type,
      }) as Parameters;
    get("contract").textContent =
      `类型 ${type.type} · version ${type.version} · revision ${type.revision.slice(0, 12)}。不补默认值；提交由服务完整校验。`;
  } catch (error) {
    formBlocked = true;
    container.append(details("保留的原参数", original));
    notify(error);
  }
}
async function discover(preserve = false): Promise<void> {
  const state = workspace();
  const lease = selection.capture();
  let retained: Parameters | undefined;
  if (preserve && formReader) {
    try {
      retained = formReader();
    } catch {
      /* Invalid raw field text remains in the current DOM. */
    }
  }
  try {
    const types = await api.request<TaskTypeDiscovery[]>(state.endpoint, "/task-types", {
      signal: lease.signal,
    });
    if (!lease.current()) return;
    if (
      !Array.isArray(types) ||
      types.some((type) => !type.type || !type.inputSchema || !/^[a-f0-9]{64}$/.test(type.revision))
    )
      throw new Error("类型发现协议无效。");
    state.types = types;
    state.discoveryError = "";
    const select = get("type") as HTMLSelectElement;
    select.replaceChildren(new Option("选择任务类型", ""));
    for (const type of types) select.append(new Option(type.type, type.type));
    if (preserve && formType) {
      select.value = formType;
      const current = types.find((type) => type.type === formType);
      if (!current) {
        formBlocked = true;
        throw new Error("当前类型已不再可提交；保留原输入。");
      }
      if (current.revision !== formRevision) {
        formBlocked = true;
        get("contract").textContent =
          "契约已变化，原输入已保留。点击“按当前契约重新编辑”确认；原提交重试仍保留旧 guard。";
        const accept = button("按当前契约重新编辑", () => {
          if (!retained) throw new Error("原输入尚不能解析，请修正原字段后重新发现。");
          renderForm(current, retained);
          accept.remove();
        });
        get("form-fields").prepend(accept);
      } else formBlocked = false;
    }
    get("discovery-status").textContent = `已发现 ${types.length} 种当前类型`;
  } catch (error) {
    if (!lease.current()) return;
    state.discoveryError = error instanceof Error ? error.message : String(error);
    get("discovery-status").textContent =
      `发现不可用：${state.discoveryError}。目录和详情权限独立，仍可使用。`;
    formBlocked = true;
  }
}
function renderBar(): void {
  const container = get("batches");
  const current = selection.endpoint;
  const cards: HTMLElement[] = [];
  const batches = bar.batches.filter(
    (batch) => current && endpointMatches(batch.endpoint, current),
  );
  const unknown = batches
    .flatMap((batch) => batch.entries)
    .filter((entry) => entry.state === "unknown").length;
  get("bar-count").textContent =
    `${batches.reduce((n, batch) => n + batch.entries.length, 0)} 项${unknown ? ` · ${unknown} 未知` : ""}`;
  for (const batch of batches) {
    const card = node("article");
    card.dataset.key = `batch:${batch.id}`;
    card.append(node("h3", `${batch.entries.length} 项 · ${batch.id.slice(-8)}`));
    const send = button(
      "按序发送此批",
      async () => {
        await bar.sendBatch(batch);
        if (!get("submission-dialog").hidden)
          get("batches")
            .querySelector<HTMLElement>(`[data-key="batch:${batch.id}"] summary`)
            ?.focus();
      },
      batch.sending || !batch.entries.every((entry) => entry.state === "draft"),
    );
    card.append(send);
    for (const [index, entry] of batch.entries.entries()) {
      const row = node("div");
      row.dataset.key = `receipt:${entry.id}`;
      row.className = "receipt";
      row.append(
        node("strong", `${index + 1}. ${entry.parameters.type} · ${statusNames[entry.state]}`),
        node("p", entry.message),
      );
      row.append(
        details("提交参数与原身份", {
          endpoint: entry.endpoint.id,
          requestId: entry.id,
          revision: entry.revision,
          parameters: entry.parameters,
        }),
      );
      if (entry.state === "draft") {
        row.append(button("上移", () => bar.move(batch, index, -1), index === 0 || batch.sending));
        row.append(
          button(
            "下移",
            () => bar.move(batch, index, 1),
            index === batch.entries.length - 1 || batch.sending,
          ),
        );
      }
      if (entry.snapshot)
        row.append(
          button(`打开 Task ${entry.snapshot.taskId.slice(-8)}`, () =>
            openTask(entry.snapshot!.taskId),
          ),
        );
      if (entry.state === "unknown" || entry.state === "failed") {
        row.append(button("原身份重试（保留 guard）", () => bar.retry(entry)));
        row.append(
          button("核对原 requestId", async () => {
            const value = await api.request<Record<string, unknown>>(
              entry.endpoint,
              `/requests/${entry.id}`,
            );
            if (selection.endpoint && endpointMatches(entry.endpoint, selection.endpoint))
              notify(
                `原请求可读，已持久化；请在目录查找对应 Task。requestId=${String(value.requestId)}。`,
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
          get("submission-dialog").querySelector<HTMLElement>("[data-close]")?.focus();
        }),
      );
    cards.push(card);
  }
  if (!batches.length) cards.push(node("p", "暂无批次。直接提交会在这里建立独立的单条回执。"));
  reconcile(container, cards);
}
function renderTasks(): void {
  const container = get("task-list");
  const rows: HTMLElement[] = [];
  if (!selection.endpoint) {
    reconcile(container, rows);
    if (container.parentElement?.tagName === "FIELDSET")
      container.parentElement.hidden = rows.length === 0;
    return;
  }
  for (const task of [...workspace().tasks.values.values()].slice(-5)) {
    const row = node("div");
    row.dataset.key = `${selection.endpoint.binding}:task:${task.taskId}`;
    row.className = "task-row";
    const taskLink = button(`${taskStatus(task)} · ${task.taskId.slice(-6)}`, () =>
      openTask(task.taskId),
    );
    taskLink.dataset.key = "open-task";
    row.append(
      taskLink,
      node(
        "span",
        `stage=${task.stage}${task.canceledAt ? " · 已取消" : ""} · 快照 ${task.timestamp}`,
      ),
    );
    if (task.execution)
      row.append(
        button(`Execution ${task.execution.executionId.slice(-8)}`, () =>
          openExecution(task.execution!.executionId),
        ),
      );
    rows.push(row);
  }
  reconcile(container, rows);
}
interface Observer {
  kind: "taskId" | "executionId";
  id: string;
  endpoint: Endpoint;
  window: EventWindow;
  historyEvents: PublicEvent[];
  controller: AbortController;
  streamController?: AbortController;
  streamState: "idle" | "live" | "stale" | "paused" | "ended";
  end: ObservationEnd;
  executionState: "unknown" | "running" | "completed" | "failed";
  reclaimed: boolean;
  executionSummary?: ExecutionSummary;
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
  get("task-detail").replaceChildren(node("p", "选择一个 Task 查看详情。"));
  get("execution-detail").replaceChildren(node("p", "选择关联 Execution 查看真实执行事实。"));
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
        if (error instanceof ApiError && [400, 401, 403, 404, 410].includes(error.status)) {
          observer.window.gap = "流不可续接；请核对权限/保留期限后显式重新观察，不能保证事件完整。";
          failures = 5;
        } else failures++;
      }
      observer.window.stale = true;
      observer.streamState = "stale";
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
  observer.end.feed(events, observer.snapshot);
  for (const event of events)
    if (observer.kind === "executionId" && event.executionId === observer.id) {
      if (event.type === "execution.started" && observer.executionState === "unknown")
        observer.executionState = "running";
      if (event.type === "execution.completed") observer.executionState = "completed";
      if (event.type === "execution.failed") observer.executionState = "failed";
      if (event.type === "execution.reclaimed") observer.reclaimed = true;
    }
  if (observer.end.ended) stopStream(observer, "ended");
}
function newObserver(kind: Observer["kind"], id: string): Observer {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) throw new Error("请输入有效 ULID。");
  const previous = kind === "taskId" ? taskObserver : executionObserver;
  previous?.controller.abort();
  return {
    kind,
    id,
    endpoint: workspace().endpoint,
    window: new EventWindow(),
    historyEvents: [],
    controller: new AbortController(),
    streamState: "idle",
    end: new ObservationEnd(kind, id),
    executionState: "unknown",
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
  navigation.close("submission-dialog", false);
  navigation.show("tasks", false);
  const observer = newObserver("taskId", id);
  taskObserver = observer;
  renderObserver(observer);
  focus("task-detail");
  try {
    const accept = workspace(observer.endpoint).tasks.begin(id);
    const snapshot = await api.request<TaskSnapshot>(observer.endpoint, `/tasks/${id}`, {
      signal: observer.controller.signal,
    });
    if (!validSnapshot(snapshot) || snapshot.taskId !== id) throw new Error("Task 快照协议无效。");
    if (!current(observer)) return;
    accept(snapshot);
    observer.snapshot = workspace(observer.endpoint).tasks.values.get(id) ?? snapshot;
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
async function openExecution(id: string): Promise<void> {
  navigation.show("executions", false);
  if (!workspace().executionDirectory.page) void queryExecutions();
  const observer = newObserver("executionId", id);
  executionObserver = observer;
  const summary = workspace().executionDirectory.page?.executions.find(
    (item) => item.executionId === id,
  );
  if (summary) {
    observer.executionSummary = summary;
    observer.end.summary(summary);
    observer.executionState = summary.completedAt
      ? "completed"
      : summary.failedAt
        ? "failed"
        : summary.state.running
          ? "running"
          : "unknown";
    observer.reclaimed = !!summary.reclaimedAt;
    if (observer.end.ended) stopStream(observer, "ended");
  }
  focus("execution-detail");
  renderObserver(observer);
  await history(observer);
  void associatedTasks(observer);
  if (current(observer)) void live(observer);
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
        `event:${event.sequence}`,
      ),
    );
  return group;
}
function renderObserver(observer: Observer): void {
  if (!current(observer)) return;
  const container = get(observer.kind === "taskId" ? "task-detail" : "execution-detail");
  const box = node("div");
  box.dataset.key = `${observer.endpoint.binding}:${observer.kind}:${observer.id}`;
  const title = observer.kind === "taskId" ? "任务详情" : "执行详情";
  box.append(node("h3", title));
  const observationState = node(
    "p",
    `${({ idle: "正在读取", live: "实时更新", stale: "观察陈旧 / 已断开", paused: "观察已暂停", ended: "观察已结束" } as const)[observer.streamState]}${observer.window.lastReceived ? ` · 最后读取 ${observer.window.lastReceived}` : ""}${observer.message ? ` · ${observer.message}` : ""}`,
  );
  observationState.className = "observation-state";
  box.append(observationState);
  const refresh = button("重新观察", () =>
    observer.kind === "taskId" ? openTask(observer.id) : openExecution(observer.id),
  );
  refresh.dataset.action = "refresh";
  box.append(
    refresh,
    button(
      "暂停观察",
      () => {
        stopStream(observer, "paused");
        renderObserver(observer);
      },
      observer.streamState === "paused" || observer.streamState === "ended",
    ),
  );
  for (const error of [observer.detailError, observer.requestError, observer.historyError])
    if (error) box.append(node("p", error));
  if (observer.window.gap) box.append(node("p", observer.window.gap));
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
      box.append(node("p", "星标模板"), details("保存的完整原参数", observer.template.parameters));
      box.append(
        button("用保存参数直接新建", () =>
          reuse(observer.endpoint, observer.template!.parameters as Parameters, true),
        ),
        button("编辑保存参数", () =>
          reuse(observer.endpoint, observer.template!.parameters as Parameters, false),
        ),
        starButton(observer.endpoint, observer.id),
      );
    }
    const task = observer.snapshot;
    if (task) {
      const effectiveEnd =
        task.canceledAt ??
        task.execution?.completedAt ??
        task.execution?.failedAt ??
        task.preparation?.failedAt ??
        task.allocation?.failedAt ??
        task.termination?.terminatedAt;
      const timeout = (effectiveEnd ?? task.timestamp) > task.deadlineAt;
      const state = node("p", taskStatus(task));
      state.className = "status";
      box.append(state);
      box.append(
        node(
          "p",
          `截止时间：${task.deadlineAt}${task.canceledAt ? ` · 取消于 ${task.canceledAt}` : ""}${timeout ? " · 超时事实保留" : ""}`,
        ),
      );
      if ((task.canceledAt || task.termination) && !observer.end.ended)
        box.append(
          node("p", "任务已终结；关联执行的终结 / 回收尚未全部确认，可继续观察或手动暂停。"),
        );
      box.append(starButton(observer.endpoint, task.taskId));
      box.append(
        details("标识与准备 / 分配时间", {
          taskId: task.taskId,
          requestId: task.requestId,
          receivedAt: task.receivedAt,
          preparation: task.preparation,
          allocation: task.allocation,
        }),
      );
      if (task.execution)
        box.append(button("查看关联执行 →", () => openExecution(task.execution!.executionId)));
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
            throw new Error("取消回执无效；结果未知，请刷新原 Task 核对，不代表已回收 Execution。");
          if (!current(observer)) return;
          accept(snapshot);
          observer.snapshot =
            workspace(observer.endpoint).tasks.values.get(observer.id) ?? snapshot;
          notify("取消回执已收到；关联 Execution 是否回收请看其事件。");
          updateFacts(observer, []);
          renderTasks();
          renderObserver(observer);
        },
        !!task.canceledAt || !!task.termination,
      );
      cancel.dataset.action = "cancel";
      box.append(cancel, details("原始 Task 快照", task, "task-snapshot"));
      if (task.result !== undefined) box.append(details("任务结果", task.result, "task-result"));
      if (task.error) box.append(details("系统故障事实", task.error));
      if (observer.request) {
        box.append(details("原始请求（GET /requests）", observer.request));
        box.append(
          button("原参数直接重做（新身份）", () =>
            reuse(observer.endpoint, originalParameters(observer.request!), true),
          ),
        );
        box.append(
          button("编辑后重做", () =>
            reuse(observer.endpoint, originalParameters(observer.request!), false),
          ),
        );
      } else box.append(node("p", "原请求尚不可读；不提供空参数重做。"));
    }
  } else {
    const events = observer.window.events;
    const state = node(
      "p",
      `${({ unknown: "执行状态尚未取得", running: "执行中", completed: "已完成", failed: "执行失败" } as const)[observer.executionState]}${observer.reclaimed ? " · 已回收" : " · 回收未确认"}`,
    );
    state.className = "status";
    box.append(state, details("执行标识", { executionId: observer.id }));
    if (observer.associated.error)
      box.append(node("p", `关联任务不可读：${observer.associated.error}`));
    if (observer.associated.page)
      box.append(
        node(
          "p",
          `可读关联任务：已加载 ${observer.associated.page.tasks.length} 条（不是全体 owner 统计）`,
        ),
      );
    for (const task of observer.associated.page?.tasks ?? [])
      box.append(button(`${task.type} · ${summaryStatus(task)} →`, () => openTask(task.taskId)));
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
      "execution.started": observer.executionSummary?.startedAt,
      "execution.completed": observer.executionSummary?.completedAt,
      "execution.failed": observer.executionSummary?.failedAt,
      "execution.reclaimed": observer.executionSummary?.reclaimedAt,
    };
    for (const [kind, label] of [
      ["execution.started", "开始"],
      ["execution.completed", "逻辑完成"],
      ["execution.failed", "执行故障"],
      ["execution.sealed", "封存"],
      ["execution.reclaimed", "回收"],
    ] as const) {
      const event = events.find((item) => item.type === kind);
      const fromSummary = dates[kind];
      box.append(
        node(
          "p",
          `${label}：${event ? event.occurredAt : fromSummary ? `${fromSummary}（目录事实）` : "当前窗口未取得证据（不等于未发生）"}`,
        ),
      );
    }
  }
  const ownEvents = observer.window.events.filter((event) =>
    observer.kind === "taskId"
      ? !event.type.startsWith("execution.")
      : event.type.startsWith("execution."),
  );
  box.append(eventList("own-events", "对象事件 · 最近窗口", ownEvents));
  box.append(
    eventList("all-events", "全部公开事件 · 最近窗口（含关联对象）", observer.window.events),
  );
  box.append(eventList("history-events", "当前历史页 · 全部公开载荷", observer.historyEvents));
  box.append(button("重新读取事件历史", () => history(observer), observer.loading));
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
  if (type) query.set("type", type);
  if (selection.endpoint && workspace().associatedExecutionId)
    query.set("executionId", workspace().associatedExecutionId);
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
  } catch (error) {
    if (!started && lease.current()) state.directory.rejectQuery(error);
  }
  if (lease.current()) renderDirectory();
}
function renderDirectory(): void {
  const container = get("directory");
  const contents = node("div");
  contents.dataset.key = "task-directory";
  if (!selection.endpoint) {
    if ((get("only-favorites") as HTMLInputElement).checked) renderStars(contents);
    else contents.append(node("p", "未配置服务；可以切换“只看收藏”查看本机保存的模板。"));
    reconcile(container, [contents]);
    return;
  }
  const association = get("association-filter");
  association.replaceChildren();
  if (workspace().associatedExecutionId)
    association.append(
      node("span", `执行关联筛选：${workspace().associatedExecutionId.slice(-8)}`),
      button("清除关联筛选", () => {
        workspace().associatedExecutionId = "";
        return queryDirectory();
      }),
    );
  if ((get("only-favorites") as HTMLInputElement).checked) {
    renderStars(contents);
    reconcile(container, [contents]);
    return;
  }
  const state = workspace();
  const directory = state.directory;
  if (directory.error)
    contents.append(node("p", `查询错误（不是空结果），以下仅为上次成功快照：${directory.error}`));
  if (directory.expired)
    contents.append(node("p", "query_expired：旧快照仅供参考。请点“重新查询”，不能继续拼页。"));
  if (!directory.page) {
    contents.append(node("p", "尚未取得任务目录。查询权限与类型发现权限独立。"));
    reconcile(container, [contents]);
    return;
  }
  contents.append(
    node(
      "p",
      `已加载 ${directory.page.tasks.length} 条 · 查询快照 ${directory.page.observedAt} · 有效至 ${directory.page.expiresAt}`,
    ),
  );
  if (directory.dropped)
    contents.append(
      node(
        "p",
        `已释放前 ${directory.dropped} 条本机摘要，仅保留最近 1000 条已加载记录；目录游标仍属于原快照。重新查询可从头查看。`,
      ),
    );
  const table = node("table");
  const head = node("tr");
  for (const title of [
    "收藏",
    "任务",
    "状态（查询时）",
    `接收时间（${Intl.DateTimeFormat().resolvedOptions().timeZone}）`,
    "操作",
  ])
    head.append(node("th", title));
  const thead = node("thead");
  thead.append(head);
  table.append(thead);
  const body = node("tbody");
  for (const task of directory.page.tasks) {
    const row = node("tr");
    row.dataset.key = `task:${state.endpoint.binding}:${task.taskId}`;
    const star = node("td");
    star.append(starButton(state.endpoint, task.taskId));
    const title = node("td");
    title.append(
      button(task.type, () => openTask(task.taskId)),
      node("small", task.taskId.slice(-8)),
    );
    row.append(star, title);
    const status = node("td", summaryStatus(task));
    const actions = node("td");
    actions.append(button("详情", () => openTask(task.taskId)));
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
      button("重做", () => redo(true)),
      button("编辑重做", () => redo(false)),
    );
    row.append(status, node("td", new Date(task.receivedAt).toLocaleString()), actions);
    body.append(row);
  }
  table.append(body);
  contents.append(table);
  if (!directory.page.tasks.length) contents.append(node("p", "没有符合筛选的任务。"));
  contents.append(
    button(
      "目录下一页（原过滤条件）",
      () => queryDirectory(true),
      !directory.page.next || directory.expired,
    ),
  );
  reconcile(container, [contents]);
}
function summaryStatus(task: TaskSummary): string {
  return `${task.state.canceled ? "已取消" : task.state.pending ? "等待资格时间" : (stages[task.state.stage] ?? task.state.stage)}${task.state.timedOut ? " · 已超时" : ""}`;
}
async function associatedTasks(observer: Observer, append = false): Promise<void> {
  try {
    await observer.associated.load(
      (query) =>
        api.request(observer.endpoint, `/tasks?${query}`, { signal: observer.controller.signal }),
      new URLSearchParams({ executionId: observer.id, sort: "created-desc" }).toString(),
      append,
      () => current(observer),
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
  try {
    let query = state.executionDirectory.query;
    if (!append) {
      const filters = new URLSearchParams({ sort: "started-desc" });
      const type = (get("execution-type") as HTMLInputElement).value;
      if (type.length > 256) throw new Error("类型筛选最多 256 字符。");
      if (type) filters.set("type", type);
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
      (query) => api.request(state.endpoint, `/executions?${query}`, { signal: lease.signal }),
      query,
      append,
      lease.current,
    );
    if (!accepted) return;
  } catch (error) {
    if (!started && lease.current()) state.executionDirectory.rejectQuery(error);
  }
  if (lease.current()) renderExecutions();
}
function renderExecutions(): void {
  const root = get("execution-directory"),
    box = node("div");
  const directory = workspace().executionDirectory;
  box.dataset.key = "execution-directory";
  if (directory.error)
    box.append(
      node(
        "p",
        `执行目录不可用：${directory.error}。请核对权限、服务版本或查询条件；不会改用本机已见记录。`,
      ),
    );
  if (directory.expired) box.append(node("p", "查询已失效，请重新查询；旧快照仅供参考。"));
  if (directory.page) {
    box.append(
      node(
        "p",
        `已加载 ${directory.page.executions.length} 个执行 · 查询快照 ${directory.page.observedAt} · 有效至 ${directory.page.expiresAt}`,
      ),
    );
    if (directory.dropped)
      box.append(node("p", `前 ${directory.dropped} 条本机摘要已释放；重新查询可从头查看。`));
    const table = node("table"),
      head = node("tr"),
      tbody = node("tbody");
    for (const title of ["执行", "状态（查询时）", "开始时间"]) head.append(node("th", title));
    const thead = node("thead");
    thead.append(head);
    table.append(thead);
    for (const execution of directory.page.executions) {
      const row = node("tr"),
        title = node("td");
      row.dataset.key = `execution:${execution.executionId}`;
      title.append(
        button(execution.type, () => openExecution(execution.executionId)),
        node("small", execution.executionId.slice(-8)),
      );
      row.append(
        title,
        node(
          "td",
          `${execution.state.completed ? "已完成" : execution.state.failed ? "执行失败" : execution.state.running ? "执行中" : "结果未确认"}${execution.state.reclaimed ? " · 已回收" : " · 未确认回收"}`,
        ),
        node("td", new Date(execution.startedAt).toLocaleString()),
      );
      tbody.append(row);
    }
    table.append(tbody);
    box.append(table);
    if (!directory.page.executions.length) box.append(node("p", "没有符合筛选的执行记录。"));
    box.append(
      button(
        "执行目录下一页",
        () => queryExecutions(true),
        !directory.page.next || directory.expired,
      ),
    );
  } else box.append(node("p", "尚未取得执行目录。"));
  reconcile(root, [box]);
}
async function reuse(endpoint: Endpoint, parameters: Parameters, direct: boolean): Promise<void> {
  const configured = endpoints.find((item) => endpointMatches(item, endpoint));
  if (!configured) throw new Error("原 Endpoint 缺失或已重新绑定；阻止静默改投。");
  if (!selection.endpoint || !endpointMatches(selection.endpoint, endpoint))
    throw new Error(`请先明确切换到收藏/原请求目标 ${endpoint.label}，不会改投当前目标。`);
  const lease = selection.capture();
  const state = workspace();
  const types = await api.request<TaskTypeDiscovery[]>(endpoint, "/task-types", {
    signal: lease.signal,
  });
  if (!lease.current()) return;
  state.types = types;
  const revision = discoveryRevision(types, parameters);
  if (direct) {
    const entry = await bar.quick(endpoint, parameters, revision);
    if (lease.current()) {
      notify(entry.message);
      if (entry.snapshot) {
        await openTask(entry.snapshot.taskId);
        void queryDirectory();
      }
    }
  } else {
    const type = types.find((item) => item.type === parameters.type)!;
    const select = get("type") as HTMLSelectElement;
    select.replaceChildren(...types.map((item) => new Option(item.type, item.type)));
    select.value = type.type;
    renderForm(type, structuredClone(parameters));
    lastQuick = undefined;
    navigation.show("tasks", false);
    get("create-title").textContent = "编辑参数并新建任务";
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
    notify(saved ? "已取消星标；不会取消任务。" : `已保存 ${endpoint.label} 的完整原参数。`);
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
  let query: URLSearchParams;
  try {
    query = new URLSearchParams(directoryQuery());
  } catch (error) {
    box.append(node("p", String(error)));
    return;
  }
  const stars = selectedStars().filter(
    (item) =>
      (!query.get("type") || item.parameters.type === query.get("type")) &&
      (!query.get("createdFrom") ||
        Date.parse(item.source!.receivedAt) >= Date.parse(query.get("createdFrom")!)) &&
      (!query.get("createdBefore") ||
        Date.parse(item.source!.receivedAt) < Date.parse(query.get("createdBefore")!)),
  );
  box.append(node("p", `本机星标 ${stars.length} 条 · 覆盖保存的全部星标，不限于目录当前页。`));
  for (const favorite of stars) {
    const article = node("article");
    article.dataset.key = `favorite:${favorite.id}`;
    const available =
      !!selection.endpoint && endpointMatches(favorite.endpoint, selection.endpoint);
    const status = available
      ? (sourceStates.get(favorite.id)?.label ?? "来源尚未核对")
      : "原目标缺失或已重绑，禁止改投";
    article.append(
      node("strong", String(favorite.parameters.type)),
      node("p", `${status} · ${favorite.endpoint.label}`),
      node("small", `来源 ${favorite.source!.taskId.slice(-8)}`),
    );
    article.append(button("查看来源 / 模板", () => openTask(favorite.source!.taskId), !available));
    article.append(
      button(
        "用保存参数新建",
        () => reuse(favorite.endpoint, favorite.parameters as Parameters, true),
        !available,
      ),
      button(
        "编辑后新建",
        () => reuse(favorite.endpoint, favorite.parameters as Parameters, false),
        !available,
      ),
    );
    article.append(details("保存的完整原参数", favorite.parameters));
    if (available) article.append(starButton(favorite.endpoint, favorite.source!.taskId));
    else
      article.append(
        button("移除此本机星标", async () => {
          await changeFavorites(`/api/favorites/${favorite.id}`, "DELETE");
        }),
      );
    box.append(article);
  }
  if (!stars.length) box.append(node("p", "暂无符合筛选的星标任务。"));
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
          } catch (error) {
            if (control.signal.aborted || !lease.current()) return;
            sourceStates.set(item.id, {
              label:
                error instanceof ApiError && error.status === 404
                  ? "来源已清理 · 保存的模板仍可用"
                  : `来源不可访问：${String(error)}`,
            });
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
  const container = get("favorites-list");
  container.replaceChildren();
  const legacy = favorites.filter((item) => !item.source);
  get("legacy-templates").hidden = !legacy.length;
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
  renderDirectory();
  if (taskObserver && current(taskObserver)) renderObserver(taskObserver);
  return true;
}
async function chooseEndpoint(id: string): Promise<void> {
  const endpoint = endpoints.find((item) => item.id === id);
  if (!endpoint) throw new Error("Endpoint 不存在。");
  selection.select(endpoint);
  const lease = selection.capture();
  starChecks?.abort();
  navigation.close("create-dialog", false);
  navigation.close("submission-dialog", false);
  navigation.show("tasks", false);
  (get("endpoint") as HTMLSelectElement).value = endpoint.id;
  closeObservers();
  formReader = undefined;
  formEndpoint = undefined;
  formRevision = undefined;
  formType = "";
  lastQuick = undefined;
  get("form-fields").replaceChildren();
  get("contract").textContent = "";
  (get("type") as HTMLSelectElement).replaceChildren(new Option("正在发现当前目标类型", ""));
  get("discovery-status").textContent = `正在发现 ${endpoint.label} 的类型…`;
  get("notice").textContent =
    `当前目标：${endpoint.label}。旧目标回执留在原分区；断流不会取消 Task。`;
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
  await Promise.all([discover(), renderFavorites()]);
  if (lease.current()) await queryDirectory();
}
async function start(): Promise<void> {
  const response = await fetch("/api/bootstrap");
  if (!response.ok) throw new Error(`UI 启动失败：${response.status}`);
  const bootstrap = (await response.json()) as { csrf: string; endpoints: Endpoint[] };
  api = new Api(bootstrap.csrf);
  endpoints = bootstrap.endpoints;
  navigation = new Navigation(document, (tab) => {
    if (tab === "executions" && selection.endpoint && !workspace().executionDirectory.page)
      void queryExecutions();
  });
  get("new-task").addEventListener("click", () => {
    get("create-title").textContent = "新建任务";
    get("dialog-notice").textContent = "";
    navigation.open("create-dialog");
  });
  get("bar-toggle").addEventListener("click", () => navigation.open("submission-dialog"));
  get("only-favorites").addEventListener("change", () => {
    if (selection.endpoint) workspace().associatedExecutionId = "";
    starChecks?.abort();
    void queryDirectory().catch(notify);
  });
  const select = get("endpoint") as HTMLSelectElement;
  for (const endpoint of endpoints) select.append(new Option(endpoint.label, endpoint.id));
  select.addEventListener("change", () => {
    void chooseEndpoint(select.value).catch(notify);
  });
  (get("type") as HTMLSelectElement).addEventListener("change", () => {
    const type = workspace().types.find(
      (entry) => entry.type === (get("type") as HTMLSelectElement).value,
    );
    if (type) {
      renderForm(type);
      lastQuick = undefined;
    }
  });
  get("discover").append(button("重新发现类型", () => discover(true)));
  get("create-actions").append(
    button(
      "提交任务",
      async () => {
        if (lastQuick?.state === "unknown")
          throw new Error(
            "上一单条提交结果未知；请使用任务栏的原身份重试/核对，或明确“主动再做一次”。",
          );
        const form = checkedForm();
        const lease = selection.capture();
        // Capture before awaiting so a lost response never permits an accidental new identity.
        const batch = bar.create(form.endpoint);
        lastQuick = bar.add(batch, form.parameters, form.revision);
        const entry = lastQuick;
        await bar.sendBatch(batch);
        if (lease.current()) notify(entry.message);
        if (lease.current() && entry.snapshot) {
          await openTask(entry.snapshot.taskId);
          void queryDirectory();
        }
      },
      false,
      300,
    ),
    button("加入多条草稿", () => {
      const form = checkedForm();
      let batch = bar.batches.find(
        (item) =>
          endpointMatches(item.endpoint, form.endpoint) &&
          !item.sending &&
          item.entries.every((entry) => entry.state === "draft"),
      );
      batch ??= bar.create(form.endpoint);
      bar.add(batch, form.parameters, form.revision);
      notify("已加入草稿，尚未提交。");
    }),
    button("查看任务栏", () => {
      navigation.close("create-dialog", false);
      navigation.open("submission-dialog");
    }),
  );
  get("history-actions").append(button("重新查询", () => queryDirectory()));
  get("execution-actions").append(button("刷新执行目录", () => queryExecutions()));
  const taskId = input("按 Task ID 打开");
  get("task-lookup").append(
    taskId.label,
    button("打开 Task", () => openTask(taskId.input.value.trim())),
  );
  const executionId = input("按 Execution ID 打开");
  get("execution-lookup").append(
    executionId.label,
    button("打开 Execution", () => openExecution(executionId.input.value.trim())),
  );
  window.addEventListener("pagehide", () => {
    closeObservers();
    starChecks?.abort();
  });
  if (endpoints[0]) await chooseEndpoint(endpoints[0].id);
  else {
    await renderFavorites();
    (get("only-favorites") as HTMLInputElement).checked = true;
    renderDirectory();
    get("execution-directory").textContent = "未配置服务，执行目录不可用。";
    notify("没有配置 Endpoint；请由本机操作员配置并重启 UI。");
  }
}
void start().catch(notify);
