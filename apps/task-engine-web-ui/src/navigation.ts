export type Tab = "tasks" | "executions";
export class Navigation {
  tab: Tab = "tasks";
  private readonly returnFocus = new Map<string, HTMLElement | null>();
  constructor(
    private readonly root: Document,
    private readonly selected: (tab: Tab) => void,
  ) {
    for (const tab of ["tasks", "executions"] as const) {
      const button = root.getElementById(`tab-${tab}`)!;
      button.addEventListener("click", () => this.show(tab));
      button.addEventListener("keydown", (event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === "Home"
              ? "tasks"
              : event.key === "End"
                ? "executions"
                : tab === "tasks"
                  ? "executions"
                  : "tasks";
          this.show(next);
          root.getElementById(`tab-${next}`)?.focus();
        }
      });
    }
    for (const dialog of root.querySelectorAll<HTMLDialogElement>("dialog")) {
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        this.close(dialog.id);
      });
      dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          this.close(dialog.id);
        }
        if (event.key !== "Tab") return;
        const controls = [
          ...dialog.querySelectorAll<HTMLElement>(
            "button,input,select,textarea,summary,a[href],[tabindex]",
          ),
        ].filter(
          (item) =>
            !(item as HTMLInputElement).disabled &&
            item.tabIndex >= 0 &&
            !item.closest("[hidden]") &&
            !item.closest("fieldset:disabled") &&
            [...dialog.querySelectorAll("details:not([open])")].every(
              (details) =>
                !details.contains(item) || !!details.querySelector("summary")?.contains(item),
            ),
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && this.root.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && this.root.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      });
      for (const close of dialog.querySelectorAll<HTMLButtonElement>("[data-close]"))
        close.addEventListener("click", () => this.close(dialog.id));
    }
    this.show("tasks", false);
  }
  show(tab: Tab, notify = true): void {
    this.tab = tab;
    for (const id of ["tasks", "executions"] as const) {
      const active = id === tab;
      this.root.getElementById(id)!.hidden = !active;
      const button = this.root.getElementById(`tab-${id}`)!;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    if (notify) this.selected(tab);
  }
  open(id: string): void {
    const dialog = this.root.getElementById(id) as HTMLDialogElement;
    if (dialog.hasAttribute("open")) return;
    this.returnFocus.set(id, this.root.activeElement as HTMLElement | null);
    dialog.hidden = false;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    (
      dialog.querySelector<HTMLElement>("[data-initial-focus]") ??
      dialog.querySelector<HTMLElement>("select,input,button")
    )?.focus();
  }
  close(id: string, restore = true): void {
    const dialog = this.root.getElementById(id) as HTMLDialogElement;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    dialog.hidden = true;
    if (restore) {
      const target = this.returnFocus.get(id);
      if (target?.isConnected && !target.closest("[hidden]")) target.focus();
      else this.root.getElementById(`tab-${this.tab}`)?.focus();
    }
  }
}
