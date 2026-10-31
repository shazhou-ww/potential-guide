export type Tab = "tasks" | "executions";
export type Overlay = "task-detail" | "execution-detail" | "create-dialog" | "submission-dialog";

export class Navigation {
  tab: Tab = "tasks";
  overlay: { id: Overlay; epoch: number; returnTo: HTMLElement | null } | undefined;
  private epoch = 0;
  private closed: { epoch: number; target: HTMLElement | null; restore: boolean } | undefined;
  constructor(
    private readonly root: Document,
    private readonly changed: () => void,
    private readonly selected: (tab: Tab) => void,
  ) {}
  show(tab: Tab, notify = true): void {
    const switched = this.tab !== tab;
    if (this.tab !== tab && this.overlay) this.close(this.overlay.id, false);
    this.tab = tab;
    this.changed();
    if (switched)
      this.root.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus({ preventScroll: true });
    if (notify) this.selected(tab);
  }
  open(id: Overlay): void {
    if (this.overlay?.id === id) return;
    const active = this.root.activeElement as HTMLElement | null;
    const returnTo =
      this.overlay?.returnTo ??
      (active && active !== this.root.body && !active.closest('[role="dialog"]')
        ? active
        : (this.closed?.target ?? null));
    this.closed = undefined;
    this.overlay = { id, epoch: ++this.epoch, returnTo };
    this.changed();
  }
  close(id: Overlay, restore = true): void {
    if (this.overlay?.id !== id) return;
    this.closed = { epoch: this.overlay.epoch, target: this.overlay.returnTo, restore };
    this.overlay = undefined;
    this.changed();
  }
  restoreFocus(epoch: number): void {
    // Radix closes asynchronously. An old layer must never steal the new layer's focus.
    if (this.overlay || this.closed?.epoch !== epoch || !this.closed.restore) return;
    const active = this.root.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== this.root.body &&
      active.isConnected &&
      !active.closest("[hidden]")
    ) {
      this.closed = undefined;
      return;
    }
    const target = this.closed.target;
    if (target?.isConnected && !target.closest("[hidden]") && !target.matches(":disabled"))
      target.focus({ preventScroll: true });
    else
      this.root
        .querySelector<HTMLElement>(`[data-tab="${this.tab}"]`)
        ?.focus({ preventScroll: true });
    this.closed = undefined;
  }
}
