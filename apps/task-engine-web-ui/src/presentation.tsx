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
import { Navigation, type Tab } from "./navigation.js";
import type { Endpoint } from "./server.js";
import { Button } from "./ui/button.tsx";
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
} as const;
export type InlineAction = keyof typeof inlineActions;

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
  readonly form = document.createElement("div");
  readonly navigation = new Navigation(
    document,
    () => this.publish(),
    (tab) => this.events.tab(tab),
  );
  events: Events = { tab: noop, endpoint: noop, type: noop, favorites: noop, create: noop };
  endpoints: Endpoint[] = [];
  types: { value: string; label: string }[] = [];
  selectedType = "";
  legacy = false;
  recent = false;
  private readonly contents = new Map<string, ReactNode>();
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
  text(id: string, text: string): void {
    this.contents.set(id, text);
    this.publish();
  }
  content(id: string): ReactNode {
    return this.contents.get(id);
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
function Workbench({ view }: { view: WorkbenchView }) {
  useSyncExternalStore(view.subscribe, view.snapshot);
  const nav = view.navigation;
  const overlay = nav.overlay;
  const content = (id: string, className?: string) => (
    <Port view={view} id={id} className={className} />
  );
  return (
    <TooltipProvider delayDuration={350}>
      <a className="skip" href="#workspace">
        跳到工作区
      </a>
      <Tabs value={nav.tab} onValueChange={(tab) => nav.show(tab as Tab)}>
        <header className="topbar">
          <h1>任务工作台</h1>
          <TabsList aria-label="工作区">
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
          <Button
            id="bar-toggle"
            variant="outline"
            aria-haspopup="dialog"
            onClick={() => nav.open("submission-dialog")}
          >
            提交任务栏 <span id="bar-count">{view.content("bar-count") ?? "0 项"}</span>
          </Button>
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
            <div className="filters">
              <Field id="history-type" label="任务类型" placeholder="全部类型" />
              <Field
                id="created-from"
                label="接收时间 · 起（包含）"
                placeholder="2026-10-31T00:00:00+08:00"
              />
              <Field
                id="created-before"
                label="接收时间 · 止（不含）"
                placeholder="带 Z 或时区偏移"
              />
              <label className="check">
                <input
                  id="only-favorites"
                  type="checkbox"
                  onChange={() => view.events.favorites()}
                />
                只看收藏
              </label>
              {content("history-actions")}
            </div>
            {content("association-filter")}
            <div className="list-pane">
              {content("directory", "table-scroll")}
              <details className="secondary">
                <summary>按任务标识定位</summary>
                {content("task-lookup", "row")}
              </details>
              <fieldset className="secondary" hidden={!view.recent}>
                <legend>最近查看</legend>
                {content("task-list", "recent")}
              </fieldset>
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
            <div className="filters">
              <Field id="execution-type" label="Run 类型" placeholder="全部类型" />
              <Field
                id="started-from"
                label="开始时间 · 起（包含）"
                placeholder="2026-10-31T00:00:00+08:00"
              />
              <Field
                id="started-before"
                label="开始时间 · 止（不含）"
                placeholder="带 Z 或时区偏移"
              />
              {content("execution-actions")}
            </div>
            <div className="list-pane">
              {content("execution-directory", "table-scroll")}
              <details className="secondary">
                <summary>按执行标识定位</summary>
                {content("execution-lookup", "row")}
              </details>
            </div>
          </TabsContent>
        </main>
      </Tabs>
      {overlay && <OverlayPanel key={overlay.epoch} view={view} />}
      <footer>关闭详情或暂停观察都不会取消任务。时间筛选使用明确时区，列表是固定查询快照。</footer>
    </TooltipProvider>
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
  if (id === "task-detail" || id === "execution-detail") {
    return (
      <Sheet open onOpenChange={close}>
        <SheetContent
          id={`${id}-sheet`}
          className="detail-sheet"
          onOpenAutoFocus={autofocus}
          onCloseAutoFocus={restore}
        >
          <SheetHeader>
            <SheetTitle id={`${id}-title`} tabIndex={-1} className="outline-none">
              {id === "task-detail" ? "任务详情" : "执行详情"}
            </SheetTitle>
            <SheetDescription>独立事实与公开事件 · 关闭不会取消任务</SheetDescription>
          </SheetHeader>
          <div className="detail-scroll">
            <Port view={view} id={id} tabIndex={-1} />
          </div>
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
      >
        <DialogHeader>
          <DialogTitle id={id === "create-dialog" ? "create-title" : `${id}-title`} tabIndex={-1}>
            {id === "create-dialog" ? (view.content("create-title") ?? "新建任务") : "提交任务栏"}
          </DialogTitle>
          <DialogDescription>
            {id === "create-dialog"
              ? "按当前服务契约填写，关闭弹窗会保留未提交的输入。"
              : "按序发出，不等待前一任务完成；未知结果保留原身份。"}
          </DialogDescription>
        </DialogHeader>
        {id === "create-dialog" ? (
          <div id="create">
            <Port view={view} id="dialog-notice" role="status" aria-live="polite" />
            <div className="row">
              <label htmlFor="type">任务类型</label>
              <select
                id="type"
                value={view.selectedType}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  view.type(value);
                  view.events.type(value);
                }}
              >
                {view.types.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              {port("discover")}
            </div>
            {port("discovery-status", "secondary")}
            <details className="secondary">
              <summary>表单契约</summary>
              {port("contract")}
            </details>
            {port("contract-actions")}
            <SchemaIsland view={view} />
            {port("create-actions", "actions")}
            <details id="legacy-templates" className="secondary" hidden={!view.legacy}>
              <summary>旧参数模板（没有任务身份）</summary>
              {port("favorites-list")}
            </details>
          </div>
        ) : (
          port("batches")
        )}
      </DialogContent>
    </Dialog>
  );
}
