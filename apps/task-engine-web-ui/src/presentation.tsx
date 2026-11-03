import { setNonce } from "get-nonce";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  History,
  Pause,
  RefreshCw,
  RotateCcw,
  SquarePen,
  FileSearch,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  type ComponentProps,
  createElement,
  type ElementType,
  type PointerEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { claimActivation } from "./dom.js";
import { ErrorLog } from "./error-log.js";
import { Navigation, type Tab } from "./navigation.js";
import type { Endpoint } from "./server.js";
import { Button } from "./ui/button.tsx";
import { DirectoryTable, type DirectoryTableData, type DirectoryRow } from "./ui/data-table.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip.tsx";

const inlineActions = {
  详情: { Icon: Eye, label: "查看详情" },
  重做: { Icon: RotateCcw, label: "重做（创建新任务）" },
  编辑重做: { Icon: SquarePen, label: "编辑参数后重做" },
  重新观察: { Icon: RefreshCw, label: "重新观察" },
  暂停观察: { Icon: Pause, label: "暂停观察（不会取消任务）" },
  "原参数直接重做（新身份）": { Icon: RotateCcw, label: "按原参数重做（创建新任务）" },
  编辑后重做: { Icon: SquarePen, label: "编辑参数后重做" },
  重新读取事件历史: { Icon: History, label: "重新读取事件历史" },
  上移: { Icon: ArrowUp, label: "上移此草稿" },
  下移: { Icon: ArrowDown, label: "下移此草稿" },
  编辑保存参数: { Icon: SquarePen, label: "编辑保存参数后新建" },
  编辑后新建: { Icon: SquarePen, label: "编辑保存参数后新建" },
  "查看来源 / 模板": { Icon: Eye, label: "查看来源或保存模板" },
  查看契约: { Icon: FileSearch, label: "查看 Bundle 契约" },
  清理此缓存: { Icon: Trash2, label: "清理此缓存（需要确认）" },
  移除此本机星标: { Icon: Trash2, label: "移除此本机星标" },
} as const;
export type InlineAction = keyof typeof inlineActions;
export interface DirectoryRowDescription extends Omit<DirectoryRow, "content"> {
  node: HTMLTableRowElement;
}

interface Action {
  run(): void | Promise<void>;
  error(error: unknown): void;
  minimumInterval: number;
  glyph?: InlineAction;
}
const actions = new WeakMap<HTMLElement, Action>();
export function describeAction(element: HTMLButtonElement, action: Action): void {
  if (element.tagName !== "BUTTON") throw new Error("ActionButton requires a button description.");
  actions.set(element, action);
}
interface RowAction {
  kind: "task" | "run";
  id: string;
  label: string;
  run(): void | Promise<void>;
  error(error: unknown): void;
}
const rowActions = new WeakMap<HTMLTableRowElement, RowAction>();
export function describeRowAction(row: HTMLTableRowElement, action: RowAction): void {
  if (row.tagName !== "TR" || row.isConnected)
    throw new Error("Row navigation requires a detached table row.");
  rowActions.set(row, action);
  row.dataset.rowAction = action.kind;
  row.dataset.entityId = action.id;
}
function selectedText(row: HTMLTableRowElement): boolean {
  const selection = row.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index++)
    if (selection.getRangeAt(index).intersectsNode(row)) return true;
  return false;
}
function rowControl(row: HTMLTableRowElement, target: EventTarget): boolean {
  if (!(target instanceof Element) || !row.contains(target)) return true;
  const control = target.closest(
    "[data-row-controls],[data-row-control],button,a,input,select,textarea,summary,label,[role=button],[role=link],[contenteditable]:not([contenteditable=false]),[tabindex]",
  );
  return !!control && control !== row;
}
function modified(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}
function NavigableRow({
  action,
  ...props
}: ComponentProps<typeof TableRow> & { action: RowAction }) {
  const pending = useRef(false);
  const gesture = useRef<{ id: number; x: number; y: number; blocked: boolean } | undefined>(
    undefined,
  );
  const track = (event: PointerEvent<HTMLTableRowElement>) => {
    const start = gesture.current;
    if (
      start &&
      start.id === event.pointerId &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
    )
      start.blocked = true;
  };
  const activate = (row: HTMLTableRowElement) => {
    if (pending.current) return;
    pending.current = true;
    row.focus({ preventScroll: true });
    void Promise.resolve()
      .then(() => {
        try {
          return action.run();
        } finally {
          // Navigation opens synchronously; an in-flight history read must not lock a closed row.
          pending.current = false;
        }
      })
      .catch(action.error);
  };
  return (
    <TableRow
      {...props}
      tabIndex={0}
      aria-label={action.label}
      aria-haspopup="dialog"
      aria-keyshortcuts="Enter Space"
      aria-describedby="directory-row-hint"
      onPointerDownCapture={(event) => {
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          blocked:
            event.button !== 0 ||
            event.isPrimary === false ||
            modified(event) ||
            rowControl(event.currentTarget, event.target) ||
            selectedText(event.currentTarget),
        };
      }}
      onPointerMoveCapture={track}
      onPointerUpCapture={track}
      onPointerCancel={() => {
        if (gesture.current) gesture.current.blocked = true;
      }}
      onDragStartCapture={() => {
        if (gesture.current) gesture.current.blocked = true;
      }}
      onClick={(event) => {
        const start = gesture.current;
        gesture.current = undefined;
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.detail > 1 ||
          modified(event) ||
          rowControl(event.currentTarget, event.target) ||
          selectedText(event.currentTarget) ||
          (event.detail > 0 && start?.blocked)
        )
          return;
        activate(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          event.target !== event.currentTarget ||
          modified(event) ||
          !["Enter", " "].includes(event.key)
        )
          return;
        event.preventDefault();
        if (!event.repeat && !selectedText(event.currentTarget)) {
          gesture.current = undefined;
          activate(event.currentTarget);
        }
      }}
    />
  );
}
function ActionButton({
  action,
  disabled,
  ...props
}: ComponentProps<typeof Button> & { action: Action }) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const glyph = action.glyph ? inlineActions[action.glyph] : undefined;
  const control = (
    <Button
      {...props}
      variant={glyph ? "ghost" : props.variant}
      size={glyph ? "icon" : props.size}
      aria-label={glyph?.label ?? props["aria-label"]}
      data-glyph-action={action.glyph}
      className={
        action.glyph === "清理此缓存" ? "text-destructive hover:text-destructive" : props.className
      }
      disabled={disabled || busy}
      data-busy={busy || undefined}
      onClick={(event) => {
        if (pending.current || !claimActivation(event.currentTarget, action.minimumInterval))
          return;
        pending.current = true;
        setBusy(true);
        void Promise.resolve()
          .then(action.run)
          .catch(action.error)
          .finally(() => {
            pending.current = false;
            setBusy(false);
          });
      }}
    >
      {glyph ? (
        <>
          <glyph.Icon aria-hidden="true" focusable="false" className="size-4" />
          <span className="sr-only">{props.children}</span>
        </>
      ) : (
        props.children
      )}
    </Button>
  );
  if (!glyph) return control;
  return (
    <Tooltip>
      <span
        data-row-control
        className="inline-flex"
        title={disabled || busy ? glyph.label : undefined}
      >
        <TooltipTrigger asChild>{control}</TooltipTrigger>
      </span>
      <TooltipContent sideOffset={6}>{glyph.label}</TooltipContent>
    </Tooltip>
  );
}
const components: Record<string, ElementType> = {
  table: Table,
  thead: TableHeader,
  tbody: TableBody,
  tr: TableRow,
  th: TableHead,
  td: TableCell,
  input: Input,
};
const propNames: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  colspan: "colSpan",
  rowspan: "rowSpan",
  readonly: "readOnly",
};
const booleanProps = new Set(["disabled", "hidden", "open", "readOnly", "multiple", "required"]);

// Detached descriptions are consumed once; React exclusively owns the resulting DOM.
// Neither the controller nor the descriptor nodes ever mutate that rendered tree.
function describe(node: Node, index: number): ReactNode {
  if (node.nodeType === 3) return node.textContent;
  if (!(node instanceof HTMLElement)) throw new Error("Unsupported view description.");
  if (node.isConnected) throw new Error("A view description must not belong to a live DOM tree.");
  const props: Record<string, unknown> = {
    key: node.dataset.key ?? (node.id || `${node.localName}:${index}`),
  };
  for (const attribute of node.attributes) {
    if (attribute.name.startsWith("on") || attribute.name === "style")
      throw new Error("Inline code and styles are not view descriptions.");
    const name = propNames[attribute.name] ?? attribute.name;
    props[name === "value" ? "defaultValue" : name] = booleanProps.has(name)
      ? true
      : attribute.value;
  }
  const rowAction = rowActions.get(node as HTMLTableRowElement);
  const action = actions.get(node);
  if (rowAction) props.action = rowAction;
  if (action) {
    props.action = action;
    props.variant =
      node.classList.contains("primary") || node.dataset.action === "提交任务"
        ? "default"
        : node.classList.contains("star")
          ? "ghost"
          : "outline";
    props.size = "sm";
  }
  const component = rowAction
    ? NavigableRow
    : action
      ? ActionButton
      : (components[node.localName] ?? node.localName);
  return createElement(component, props, ...[...node.childNodes].map(describe));
}
interface Events {
  tab(tab: Tab): void;
  endpoint(id: string): void;
  type(value: string): void;
  favorites(): void;
  create(): void;
}
const noop = () => {};
export class WorkbenchView {
  readonly errors = new ErrorLog();
  errorsOpen = false;
  readonly form = document.createElement("div");
  readonly navigation = new Navigation(
    document,
    () => this.publish(),
    (tab) => this.events.tab(tab),
  );
  events: Events = {
    tab: noop,
    endpoint: noop,
    type: noop,
    favorites: noop,
    create: noop,
  };
  endpoints: Endpoint[] = [];
  types: { value: string; label: string }[] = [];
  selectedType = "";
  legacy = false;
  recent = false;
  private readonly contents = new Map<string, ReactNode>();
  readonly directories: Record<"tasks" | "runs", DirectoryTableData> = {
    tasks: { rows: [], scope: "", query: "", complete: false },
    runs: { rows: [], scope: "", query: "", complete: false },
  };
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private root: Root;
  private disposed = false;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly snapshot = () => this.revision;
  constructor(container: HTMLElement) {
    this.form.id = "form-fields";
    const nonce = document.querySelector<HTMLMetaElement>('meta[name="ui-style-nonce"]')?.content;
    if (!nonce) throw new Error("Missing UI style nonce.");
    setNonce(nonce);
    this.root = createRoot(container);
    flushSync(() => this.root.render(<Workbench view={this} />));
  }
  publish(): void {
    if (this.disposed) return;
    this.revision++;
    flushSync(() => {
      for (const listener of this.listeners) listener();
    });
  }
  render(id: string, nodes: Node[]): void {
    this.contents.set(id, nodes.map(describe));
    this.publish();
  }
  directory(
    kind: "tasks" | "runs",
    data: Omit<DirectoryTableData, "rows" | "more"> & {
      rows: DirectoryRowDescription[];
      more?: HTMLButtonElement | undefined;
    },
    notices: Node[],
  ): void {
    this.directories[kind] = {
      ...data,
      rows: data.rows.map(({ node, ...row }, index) => ({
        ...row,
        content: describe(node, index),
      })),
      more: data.more ? describe(data.more, 0) : undefined,
    };
    this.render(kind === "tasks" ? "directory" : "execution-directory", notices);
  }
  text(id: string, text: string): void {
    this.contents.set(id, text);
    this.publish();
  }
  content(id: string): ReactNode {
    return this.contents.get(id);
  }
  error(source: string, message: string, event = false, label = source): void {
    if (event) this.errors.record(source, message, label);
    else this.errors.observe(source, message, label);
  }
  toggleErrors(open: boolean): void {
    this.errorsOpen = open;
    this.publish();
  }
  options(types: { value: string; label: string }[]): void {
    this.types = types;
    this.publish();
  }
  type(value: string): void {
    this.selectedType = value;
    this.publish();
  }
  dispose(): void {
    this.disposed = true;
    flushSync(() => this.root.unmount());
    this.listeners.clear();
  }
}
function Port({ view, id, ...props }: { view: WorkbenchView; id: string } & ComponentProps<"div">) {
  return (
    <div id={id} {...props}>
      {view.content(id)}
    </div>
  );
}
function SchemaIsland({ view }: { view: WorkbenchView }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!host.current) throw new Error("Missing schema island host.");
    host.current.append(view.form);
    return () => {
      view.form.remove();
    };
  }, [view]);
  // Only form.ts owns these descendants, including their raw invalid/uncommitted text.
  return <div data-schema-island ref={host} />;
}
function Field({ id, label, placeholder }: { id: string; label: string; placeholder: string }) {
  return (
    <label htmlFor={id}>
      {label}
      <Input id={id} placeholder={placeholder} />
    </label>
  );
}
function DirectoryPanel({ view, kind }: { view: WorkbenchView; kind: "tasks" | "runs" }) {
  const task = kind === "tasks";
  const id = task ? "directory" : "execution-directory";
  const actionsId = task ? "history-actions" : "execution-actions";
  return (
    <div id={id} className="table-scroll">
      <DirectoryTable
        kind={kind}
        data={view.directories[kind]}
        info={<div className="directory-notices">{view.content(id)}</div>}
        favoriteFilter={
          task ? (
            <label className="directory-favorites">
              <input id="only-favorites" type="checkbox" onChange={() => view.events.favorites()} />
              只看收藏
            </label>
          ) : undefined
        }
        bundleFilter={
          <>
            <Field
              id={task ? "history-type" : "execution-type"}
              label="Bundle Digest（服务端查询）"
              placeholder="完整 sha256:…（可选）"
            />
            <p>修改后点击表格底部“{task ? "重新查询" : "刷新执行目录"}”。</p>
            {task && <Port view={view} id="association-filter" />}
          </>
        }
        timeFilter={
          <>
            <Field
              id={task ? "created-from" : "started-from"}
              label={`${task ? "接收" : "开始"}时间 · 起（包含）`}
              placeholder="2026-10-31T00:00:00+08:00"
            />
            <Field
              id={task ? "created-before" : "started-before"}
              label={`${task ? "接收" : "开始"}时间 · 止（不含）`}
              placeholder="带 Z 或时区偏移"
            />
            <p>服务端时间范围，填写明确时区后在表格底部重新查询。</p>
          </>
        }
        actions={<Port view={view} id={actionsId} />}
      />
    </div>
  );
}
function Workbench({ view }: { view: WorkbenchView }) {
  useSyncExternalStore(view.subscribe, view.snapshot);
  const nav = view.navigation;
  const overlay = nav.overlay;
  return (
    <TooltipProvider delayDuration={350}>
      <a className="skip" href="#workspace">
        跳到工作区
      </a>
      <Tabs
        className="workbench-shell"
        value={nav.tab}
        onValueChange={(tab) => nav.show(tab as Tab)}
      >
        <header className="topbar">
          <h1>任务工作台</h1>
          <TabsList variant="line" className="workspace-navigation" aria-label="工作区">
            <TabsTrigger id="tab-tasks" aria-controls="tasks" value="tasks" data-tab="tasks">
              任务
            </TabsTrigger>
            <TabsTrigger
              id="tab-executions"
              aria-controls="executions"
              value="executions"
              data-tab="executions"
            >
              Run
            </TabsTrigger>
            <TabsTrigger id="tab-cache" aria-controls="cache" value="cache" data-tab="cache">
              Bundle 缓存
            </TabsTrigger>
          </TabsList>
          <label className="endpoint-label" htmlFor="endpoint">
            服务
            <select
              id="endpoint"
              aria-label="受控 Endpoint"
              onChange={(event) => view.events.endpoint(event.currentTarget.value)}
            >
              {view.endpoints.map((endpoint) => (
                <option key={`${endpoint.id}:${endpoint.binding}`} value={endpoint.id}>
                  {endpoint.label}
                </option>
              ))}
            </select>
          </label>
        </header>
        <Port view={view} id="notice" role="status" aria-live="polite" />
        <main id="workspace">
          <p id="directory-row-hint" className="sr-only">
            聚焦数据行后按 Enter 或空格查看详情；星标和操作列是独立操作。
          </p>
          <TabsContent
            value="tasks"
            id="tasks"
            aria-labelledby="tab-tasks"
            forceMount
            hidden={nav.tab !== "tasks"}
          >
            <div className="page-heading">
              <p>当前与历史任务</p>
              <Button id="new-task" aria-haspopup="dialog" onClick={() => view.events.create()}>
                ＋ 新建任务
              </Button>
            </div>
            <div className="list-pane">
              <DirectoryPanel view={view} kind="tasks" />
            </div>
          </TabsContent>
          <TabsContent
            value="executions"
            id="executions"
            aria-labelledby="tab-executions"
            forceMount
            hidden={nav.tab !== "executions"}
          >
            <div className="page-heading">
              <p>服务中的完整 Run 记录，包括其他客户端触发的尝试；共享 Run 只列一次。</p>
            </div>
            <div className="list-pane">
              <DirectoryPanel view={view} kind="runs" />
            </div>
          </TabsContent>
          <TabsContent
            value="cache"
            id="cache"
            aria-labelledby="tab-cache"
            forceMount
            hidden={nav.tab !== "cache"}
          >
            <div className="page-heading">
              <p>所选 Endpoint 的 Task Bundle 缓存</p>
            </div>
            <p className="secondary">
              缓存位于服务机器，不是浏览器本地文件；清理不删除任务历史或原归档。
            </p>
            <Port view={view} id="bundle-cache" role="region" aria-label="Bundle 缓存列表与详情" />
          </TabsContent>
        </main>
      </Tabs>
      {overlay && <OverlayPanel key={overlay.epoch} view={view} />}
      <ErrorCenter view={view} />
    </TooltipProvider>
  );
}
function ErrorButton({ view }: { view: WorkbenchView }) {
  return (
    <Button
      className="error-launcher"
      variant="outline"
      aria-label={`错误日志：${view.errors.entries.length} 个问题`}
      aria-haspopup="dialog"
      aria-expanded={view.errorsOpen}
      onClick={() => view.toggleErrors(true)}
    >
      <TriangleAlert aria-hidden="true" />
      <span aria-live="polite">{view.errors.entries.length}</span>
    </Button>
  );
}
function ErrorCenter({ view }: { view: WorkbenchView }) {
  return (
    <Sheet open={view.errorsOpen} onOpenChange={(open) => view.toggleErrors(open)}>
      {!view.navigation.overlay && <ErrorButton view={view} />}
      <SheetContent
        side="bottom"
        className="error-sheet"
        closeLabel="关闭错误日志"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.querySelector<HTMLElement>(".error-launcher")?.focus({ preventScroll: true });
        }}
      >
        <SheetHeader>
          <SheetTitle>错误日志 ({view.errors.entries.length})</SheetTitle>
          <SheetDescription>
            当前页面会话，最多保留 100 个问题。清理日志不会取消任务或修复故障。
          </SheetDescription>
          <Button
            variant="outline"
            size="sm"
            disabled={!view.errors.entries.length}
            onClick={() => {
              view.errors.clear();
              view.publish();
            }}
          >
            清空日志
          </Button>
        </SheetHeader>
        <div className="error-scroll">
          {!view.errors.entries.length && <p>暂无错误记录。</p>}
          {view.errors.entries.map((entry) => (
            <div key={entry.id} className="error-entry">
              <details>
                <summary>
                  <strong>{entry.label}</strong> · {entry.count} 次
                  {entry.resolved ? " · 已恢复" : " · 错误记录"}
                  <span className="error-summary">{entry.message}</span>
                </summary>
                <p>
                  首次：{entry.firstSeen} · 最近：{entry.lastSeen}
                </p>
                <p>来源：{entry.source}</p>
                <pre>{entry.message}</pre>
              </details>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`清理错误记录 ${entry.id}`}
                onClick={() => {
                  view.errors.clear(entry.id);
                  view.publish();
                }}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
function OverlayPanel({ view }: { view: WorkbenchView }) {
  const nav = view.navigation;
  if (!nav.overlay) return null;
  const { id, epoch } = nav.overlay;
  const close = (open: boolean) => {
    if (!open) nav.close(id);
  };
  const restore = (event: Event) => {
    event.preventDefault();
    nav.restoreFocus(epoch);
  };
  const autofocus = (event: Event) => {
    event.preventDefault();
    document
      .getElementById(id === "create-dialog" ? "type" : `${id}-title`)
      ?.focus({ preventScroll: true });
  };
  const port = (name: string, className?: string) => (
    <Port view={view} id={name} className={className} />
  );
  const protectErrors = (event: Event) => {
    if (view.errorsOpen) event.preventDefault();
  };
  if (id === "task-detail" || id === "execution-detail" || id === "cache-detail") {
    return (
      <Sheet open onOpenChange={close}>
        <SheetContent
          id={`${id}-sheet`}
          className="detail-sheet"
          onOpenAutoFocus={autofocus}
          onCloseAutoFocus={restore}
          onInteractOutside={protectErrors}
          onEscapeKeyDown={protectErrors}
        >
          <SheetHeader>
            <SheetTitle id={`${id}-title`} tabIndex={-1} className="outline-none">
              {id === "task-detail"
                ? "任务详情"
                : id === "cache-detail"
                  ? "Bundle 契约"
                  : "执行详情"}
            </SheetTitle>
            <SheetDescription>
              {id === "cache-detail"
                ? "服务端缓存的声明与解析后契约"
                : "独立事实与公开事件 · 关闭不会取消任务"}
            </SheetDescription>
          </SheetHeader>
          <div className="detail-scroll">
            <Port view={view} id={id} tabIndex={-1} />
          </div>
          <ErrorButton view={view} />
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open onOpenChange={close}>
      <DialogContent
        id={id}
        className="workbench-dialog"
        onOpenAutoFocus={autofocus}
        onCloseAutoFocus={restore}
        onInteractOutside={protectErrors}
        onEscapeKeyDown={protectErrors}
      >
        <DialogHeader>
          <DialogTitle id={id === "create-dialog" ? "create-title" : `${id}-title`} tabIndex={-1}>
            {id === "create-dialog"
              ? (view.content("create-title") ?? "新建任务")
              : "清理 Bundle 缓存"}
          </DialogTitle>
          <DialogDescription>
            {id === "create-dialog"
              ? "直接提交当前任务，或加入批量后统一提交。关闭弹窗保留输入、批量草稿与回执。"
              : "只清理缓存内容，不删除任务历史或原归档。"}
          </DialogDescription>
        </DialogHeader>
        {id === "create-dialog" ? (
          <div id="create">
            <Port view={view} id="dialog-notice" role="status" aria-live="polite" />
            {port("discovery-status", "secondary")}
            <SchemaIsland view={view} />
            <details className="secondary">
              <summary>表单契约</summary>
              {port("contract")}
            </details>
            {port("contract-actions")}
            {port("create-actions", "actions")}
            <section className="submission-batches" aria-labelledby="batch-title">
              <h3 id="batch-title" tabIndex={-1}>
                批量草稿与提交回执 <span id="bar-count">{view.content("bar-count") ?? "0 项"}</span>
              </h3>
              <p className="secondary">
                批量按序发出，不等待任务完成；未知结果保留原身份，可在这里核对。
              </p>
              {port("batches")}
            </section>
            <details id="legacy-templates" className="secondary" hidden={!view.legacy}>
              <summary>旧参数模板（没有任务身份）</summary>
              {port("favorites-list")}
            </details>
          </div>
        ) : (
          port("cache-confirmation")
        )}
        <ErrorButton view={view} />
      </DialogContent>
    </Dialog>
  );
}
