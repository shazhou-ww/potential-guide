import type {
  HistoryPage,
  Observation,
  PublicEvent,
  TaskSnapshot,
  TaskTypeDiscovery,
} from "@potential-guide/task-protocol";
import { envelopeKeys, envelopeSchema, schemaEditor } from "./form.js";
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
  validSnapshot,
} from "./model.js";
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
): HTMLButtonElement {
  const result = node("button", text);
  result.type = "button";
  result.disabled = disabled;
  result.dataset.action = text;
  result.addEventListener("click", () => {
    result.disabled = true;
    void Promise.resolve()
      .then(action)
      .catch(notify)
      .finally(() => {
        result.disabled = disabled;
      });
  });
  return result;
}
function details(title: string, value: unknown): HTMLDetailsElement {
  const result = node("details");
  result.append(node("summary", title), node("pre", JSON.stringify(value, null, 2)));
  return result;
}
function notify(error: unknown): void {
  get("notice").textContent = error instanceof Error ? error.message : String(error);
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
let endpoints: Endpoint[] = [];
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
  tasks: Map<string, TaskSnapshot>;
  directory: Directory;
  directoryError: string;
}
function workspace(endpoint = selection.endpoint): Workspace {
  if (!endpoint) throw new Error("请先配置并选择 Endpoint。");
  let state = states.get(endpoint.binding);
  if (!state) {
    state = {
      endpoint,
      types: [],
      discoveryError: "",
      tasks: new Map(),
      directory: new Directory(),
      directoryError: "",
    };
    states.set(endpoint.binding, state);
  }
  return state;
}
function rememberTask(endpoint: Endpoint, snapshot: TaskSnapshot): void {
  const tasks = workspace(endpoint).tasks;
  const previous = tasks.get(snapshot.taskId);
  if (previous && previous.timestamp > snapshot.timestamp) return;
  tasks.set(snapshot.taskId, snapshot);
  while (tasks.size > 200) {
    const oldest = tasks.keys().next().value;
    if (oldest) tasks.delete(oldest);
  }
  let bytes = 0;
  for (const value of [...tasks.values()].reverse()) {
    bytes += new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (bytes > 8_388_608) tasks.delete(value.taskId);
  }
}
const bar = new SubmissionBar(
  (entry) =>
    api.request(entry.endpoint, "/tasks", {
      method: "POST",
      body: entry.parameters,
      headers: { "Idempotency-Key": entry.id, "If-Match": `"${entry.revision}"` },
    }),
  () => {
    for (const batch of bar.batches)
      for (const entry of batch.entries)
        if (entry.snapshot) rememberTask(entry.endpoint, entry.snapshot);
    renderBar();
    renderTasks();
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
  container.replaceChildren();
  const batches = bar.batches.filter(
    (batch) => current && endpointMatches(batch.endpoint, current),
  );
  get("bar-count").textContent = `${batches.length} 批次 · 单条快捷不发送待发多条`;
  for (const batch of batches) {
    const card = node("article");
    card.append(node("h3", `${batch.entries.length} 项 · ${batch.id.slice(-8)}`));
    if (batch.entries.every((entry) => entry.state === "draft"))
      card.append(button("按序发送此批", () => bar.sendBatch(batch), batch.sending));
    for (const [index, entry] of batch.entries.entries()) {
      const row = node("div");
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
        }),
      );
    container.append(card);
  }
  if (!batches.length)
    container.append(node("p", "暂无批次。直接提交会在这里建立独立的单条回执。"));
}
function renderTasks(): void {
  const container = get("task-list");
  container.replaceChildren();
  if (!selection.endpoint) return;
  for (const task of workspace().tasks.values()) {
    const row = node("div");
    row.className = "task-row";
    row.append(
      button(task.taskId, () => openTask(task.taskId)),
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
    container.append(row);
  }
}
interface Observer {
  kind: "taskId" | "executionId";
  id: string;
  endpoint: Endpoint;
  window: EventWindow;
  historyEvents: PublicEvent[];
  controller: AbortController;
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
  let failures = 0;
  while (current(observer) && failures < 5) {
    try {
      const query = new URLSearchParams({ [observer.kind]: observer.id });
      const response = await fetch(api.path(observer.endpoint, `/events?${query}`), {
        headers: api.headers(
          observer.endpoint,
          observer.window.streamCursor ? { "Last-Event-ID": observer.window.streamCursor } : {},
        ),
        signal: observer.controller.signal,
      });
      if (!response.ok) await api.decode(response);
      await consumeSse(response, (observation: Observation) => {
        if (!current(observer)) return;
        observer.window.observation(observation);
        observer.message = "";
        failures = 0;
        for (const snapshot of observation.snapshots) {
          rememberTask(observer.endpoint, snapshot);
          if (observer.kind === "taskId" && snapshot.taskId === observer.id)
            observer.snapshot = snapshot;
        }
        renderTasks();
        renderObserver(observer);
      });
      if (!current(observer)) return;
      observer.message = "流已断开，按最后确认游标续接；不会重提任务。";
    } catch (error) {
      if (!current(observer)) return;
      observer.message = String(error);
      if (error instanceof ApiError && [400, 401, 403, 404, 410].includes(error.status)) {
        observer.window.gap = "流不可续接；请核对权限/保留期限后显式重新观察，不能保证事件完整。";
        failures = 5;
      } else failures++;
    }
    observer.window.stale = true;
    renderObserver(observer);
    if (failures < 5)
      await new Promise<void>((resolveDelay) => {
        const finish = () => {
          clearTimeout(timer);
          observer.controller.signal.removeEventListener("abort", finish);
          resolveDelay();
        };
        const timer = setTimeout(finish, Math.min(1000 * (failures + 1), 5000));
        observer.controller.signal.addEventListener("abort", finish, { once: true });
      });
  }
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
    message: "",
    detailError: "",
    requestError: "",
    historyError: "",
    loading: false,
  };
}
async function openTask(id: string): Promise<void> {
  const observer = newObserver("taskId", id);
  taskObserver = observer;
  renderObserver(observer);
  focus("tasks");
  try {
    const snapshot = await api.request<TaskSnapshot>(observer.endpoint, `/tasks/${id}`, {
      signal: observer.controller.signal,
    });
    if (!validSnapshot(snapshot) || snapshot.taskId !== id) throw new Error("Task 快照协议无效。");
    if (!current(observer)) return;
    observer.snapshot = snapshot;
    rememberTask(observer.endpoint, observer.snapshot);
    renderTasks();
    renderObserver(observer);
    // Request authorization is independent from task/history authorization.
    void api
      .request<Record<string, unknown>>(
        observer.endpoint,
        `/requests/${observer.snapshot.requestId}`,
        { signal: observer.controller.signal },
      )
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
      renderObserver(observer);
    }
  }
  await history(observer);
  if (current(observer)) void live(observer);
}
async function openExecution(id: string): Promise<void> {
  const observer = newObserver("executionId", id);
  executionObserver = observer;
  focus("executions");
  renderObserver(observer);
  await history(observer);
  if (current(observer)) void live(observer);
}
function eventList(title: string, events: PublicEvent[]): HTMLElement {
  const group = node("details");
  group.append(node("summary", `${title}（${events.length}）`));
  for (const event of events)
    group.append(details(`#${event.sequence} ${event.type} · ${event.occurredAt}`, event));
  return group;
}
function renderObserver(observer: Observer): void {
  if (!current(observer)) return;
  const container = get(observer.kind === "taskId" ? "task-detail" : "execution-detail");
  // Keep keyboard focus and expanded event details stable during frequent SSE updates.
  const focused = document.activeElement as HTMLElement | null;
  const focusedAction = focused?.closest("[data-action]")?.getAttribute("data-action");
  const expanded = new Set(
    [...container.querySelectorAll("details[open]")].map(
      (item) => item.querySelector("summary")?.textContent,
    ),
  );
  const box = node("div");
  box.append(
    node("h3", observer.id),
    node(
      "p",
      `${observer.window.stale ? "观察陈旧 / 未连接" : "连接中"} · 最后接收 ${observer.window.lastReceived || "尚无"} · ${observer.message}`,
    ),
  );
  const refresh = button("重新观察（重新读取历史）", () =>
    observer.kind === "taskId" ? openTask(observer.id) : openExecution(observer.id),
  );
  refresh.dataset.action = "refresh";
  box.append(refresh);
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
      box.append(
        node(
          "p",
          `stage: ${task.stage} · 取消: ${task.canceledAt ?? "未取消"} · 超时: ${timeout ? "是（按快照事实计算）" : "否（截至快照时间）"}`,
        ),
      );
      box.append(node("p", "取消与超时不覆盖 stage；Task 终结不等于 Execution 已回收。"));
      if (task.execution)
        box.append(
          button(`关联 Execution ${task.execution.executionId}`, () =>
            openExecution(task.execution!.executionId),
          ),
        );
      const cancel = button(
        "取消选中的 Task",
        async () => {
          if (!current(observer)) return;
          const snapshot = await api.request<TaskSnapshot>(
            observer.endpoint,
            `/tasks/${observer.id}/cancel`,
            { method: "POST" },
          );
          if (!validSnapshot(snapshot) || snapshot.taskId !== observer.id)
            throw new Error("取消回执无效；结果未知，请刷新原 Task 核对，不代表已回收 Execution。");
          if (!current(observer)) return;
          observer.snapshot = snapshot;
          rememberTask(observer.endpoint, snapshot);
          notify("取消回执已收到；关联 Execution 是否回收请看其事件。");
          renderTasks();
          renderObserver(observer);
        },
        !!task.canceledAt || !!task.termination,
      );
      cancel.dataset.action = "cancel";
      box.append(cancel, details("Task 快照 · 准备/分配/执行关联", task));
      if (task.result !== undefined)
        box.append(details("结果（业务否定不是系统执行故障）", task.result));
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
        box.append(
          button("收藏原参数", () =>
            saveFavorite(observer.endpoint, originalParameters(observer.request!)),
          ),
        );
      } else box.append(node("p", "原请求尚不可读；不提供空参数重做。"));
    }
  } else {
    const events = observer.window.events;
    const knownOwners = [...workspace().tasks.values()].filter(
      (task) => task.execution?.executionId === observer.id,
    );
    box.append(
      node("p", `已观察关联 Task：${knownOwners.length}（不是全部 owners 或 worker 统计）`),
    );
    for (const task of knownOwners) box.append(button(task.taskId, () => openTask(task.taskId)));
    for (const [kind, label] of [
      ["execution.started", "开始"],
      ["execution.completed", "逻辑完成"],
      ["execution.failed", "执行故障"],
      ["execution.sealed", "封存"],
      ["execution.reclaimed", "回收"],
    ]) {
      const event = events.find((item) => item.type === kind);
      box.append(
        node("p", `${label}：${event ? event.occurredAt : "当前窗口未取得证据（不等于未发生）"}`),
      );
    }
  }
  const ownEvents = observer.window.events.filter((event) =>
    observer.kind === "taskId"
      ? !event.type.startsWith("execution.")
      : event.type.startsWith("execution."),
  );
  box.append(eventList("对象事件 · 最近窗口", ownEvents));
  box.append(eventList("全部公开事件 · 最近窗口（含关联对象）", observer.window.events));
  box.append(eventList("当前历史页 · 全部公开载荷", observer.historyEvents));
  const more = button(
    "下一页事件历史",
    () => history(observer, true),
    !observer.window.historyNext || observer.loading,
  );
  more.dataset.action = "history-next";
  box.append(more);
  container.replaceChildren(box);
  for (const detail of container.querySelectorAll("details"))
    if (expanded.has(detail.querySelector("summary")?.textContent)) detail.open = true;
  if (focused && !focused.isConnected && focusedAction)
    [...container.querySelectorAll<HTMLElement>("[data-action]")]
      .find((item) => item.dataset.action === focusedAction)
      ?.focus({ preventScroll: true });
}
function directoryQuery(): string {
  const query = new URLSearchParams({ sort: "created-desc" });
  const type = (get("history-type") as HTMLInputElement).value;
  if (type) query.set("type", type);
  for (const [id, key] of [
    ["created-from", "createdFrom"],
    ["created-before", "createdBefore"],
  ] as const) {
    const value = (get(id) as HTMLInputElement).value;
    if (value) {
      if (!/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
        throw new Error("时间必须包含明确时区，例如 2026-10-31T00:00:00+08:00。");
      query.set(key, value);
    }
  }
  return query.toString();
}
async function queryDirectory(append = false): Promise<void> {
  const state = workspace();
  const lease = selection.capture();
  try {
    await state.directory.load(
      (query) => api.request(state.endpoint, `/tasks?${query}`, { signal: lease.signal }),
      append ? state.directory.query : directoryQuery(),
      append,
      lease.current,
    );
    if (lease.current()) state.directoryError = "";
  } catch (error) {
    if (lease.current()) state.directoryError = String(error);
  }
  if (lease.current()) renderDirectory();
}
function renderDirectory(): void {
  const container = get("directory");
  container.replaceChildren();
  if (!selection.endpoint) return;
  const state = workspace();
  const directory = state.directory;
  if (state.directoryError)
    container.append(
      node("p", `查询错误（不是空结果），以下仅为上次成功快照：${state.directoryError}`),
    );
  if (directory.expired)
    container.append(node("p", "query_expired：旧快照仅供参考。请点“重新查询”，不能继续拼页。"));
  if (!directory.page) {
    container.append(node("p", "尚未查询。目录来自 Endpoint，不依赖类型发现权限。"));
    return;
  }
  container.append(
    node(
      "p",
      `固定快照 ${directory.page.observedAt} · 有效至 ${directory.page.expiresAt} · 已加载 ${directory.page.tasks.length} 条（非总数）`,
    ),
  );
  container.append(node("p", `原查询：${new URLSearchParams(directory.query).toString()}`));
  if (directory.dropped)
    container.append(
      node(
        "p",
        `已释放前 ${directory.dropped} 条本机摘要，仅保留最近 1000 条已加载记录；目录游标仍属于原快照。重新查询可从头查看。`,
      ),
    );
  const table = node("table");
  const head = node("tr");
  for (const title of ["Task / 类型", "receivedAt", "摘要状态", "操作"])
    head.append(node("th", title));
  const thead = node("thead");
  thead.append(head);
  table.append(thead);
  const body = node("tbody");
  for (const task of directory.page.tasks) {
    const row = node("tr");
    row.append(node("td", `${task.taskId}\n${task.type}`), node("td", task.receivedAt));
    const status = node("td");
    status.append(details(task.state.stage, task.state));
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
      button("直接重做", () => redo(true)),
      button("编辑后重做", () => redo(false)),
    );
    row.append(status, actions);
    body.append(row);
  }
  table.append(body);
  container.append(table);
  if (!directory.page.tasks.length) container.append(node("p", "本次查询成功：没有可见记录。"));
  container.append(
    button(
      "目录下一页（原过滤条件）",
      () => queryDirectory(true),
      !directory.page.next || directory.expired,
    ),
  );
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
    if (lease.current() && entry.snapshot) await openTask(entry.snapshot.taskId);
  } else {
    const type = types.find((item) => item.type === parameters.type)!;
    const select = get("type") as HTMLSelectElement;
    select.replaceChildren(...types.map((item) => new Option(item.type, item.type)));
    select.value = type.type;
    renderForm(type, structuredClone(parameters));
    lastQuick = undefined;
    focus("create");
  }
}
async function saveFavorite(endpoint: Endpoint, parameters: Parameters): Promise<void> {
  const name = (get("favorite-name") as HTMLInputElement).value.trim();
  if (!name) throw new Error("请在创建区填写收藏名称，再收藏参数。");
  await api.local("/api/favorites", "POST", { name, endpoint, parameters });
  await renderFavorites();
  notify("已保存本机收藏；不会保存后端凭据，也不会修改原收藏。");
}
async function renderFavorites(): Promise<void> {
  const favorites = await api.local<Favorite[]>("/api/favorites");
  const container = get("favorites-list");
  container.replaceChildren();
  for (const favorite of favorites) {
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
        "直接再发（新身份）",
        () => reuse(favorite.endpoint, favorite.parameters as Parameters, true),
        !configured,
      ),
    );
    article.append(
      button(
        "编辑后再发",
        () => reuse(favorite.endpoint, favorite.parameters as Parameters, false),
        !configured,
      ),
    );
    article.append(
      button("删除此收藏", async () => {
        await api.local(`/api/favorites/${favorite.id}`, "DELETE");
        await renderFavorites();
      }),
    );
    container.append(article);
  }
  if (!favorites.length)
    container.append(node("p", "尚无收藏。收藏保存在 UI Server 所在电脑；不跟随服务历史清理。"));
}
async function chooseEndpoint(id: string): Promise<void> {
  const endpoint = endpoints.find((item) => item.id === id);
  if (!endpoint) throw new Error("Endpoint 不存在。");
  selection.select(endpoint);
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
  for (const id of ["history-type", "created-from", "created-before"])
    (get(id) as HTMLInputElement).value = "";
  renderBar();
  renderTasks();
  renderDirectory();
  await Promise.all([discover(), renderFavorites()]);
}
async function start(): Promise<void> {
  const response = await fetch("/api/bootstrap");
  if (!response.ok) throw new Error(`UI 启动失败：${response.status}`);
  const bootstrap = (await response.json()) as { csrf: string; endpoints: Endpoint[] };
  api = new Api(bootstrap.csrf);
  endpoints = bootstrap.endpoints;
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
    button("提交任务", async () => {
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
      if (lease.current() && entry.snapshot) await openTask(entry.snapshot.taskId);
    }),
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
    button("收藏当前参数", async () => {
      const form = checkedForm();
      await saveFavorite(form.endpoint, form.parameters);
    }),
  );
  get("history-actions").append(button("重新查询", () => queryDirectory()));
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
  window.addEventListener("pagehide", closeObservers);
  if (endpoints[0]) await chooseEndpoint(endpoints[0].id);
  else {
    await renderFavorites();
    notify("没有配置 Endpoint；请由本机操作员配置并重启 UI。");
  }
}
void start().catch(notify);
