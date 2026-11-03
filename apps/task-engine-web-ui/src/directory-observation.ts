import type {
  CollectionEnvelope,
  RunPage,
  RunSummary,
  TaskPage,
  TaskSummary,
} from "@potential-guide/task-protocol";
import { ApiError, type Directory } from "./model.js";

export async function observeDirectory<P extends TaskPage | RunPage>(options: {
  directory: Directory<P>;
  signal: AbortSignal;
  current(): boolean;
  canRefresh(): boolean;
  wait(milliseconds: number): Promise<void>;
  fetchPage(query: string): Promise<P>;
  stream(
    revision: string,
    receive: (envelope: CollectionEnvelope<TaskSummary | RunSummary>) => void,
  ): Promise<void>;
  changed(): void;
  failed?(message: string): void;
}): Promise<void> {
  const { directory, signal, changed } = options;
  const active = () => !signal.aborted && options.current();
  let failures = 0;
  while (active()) {
    if (directory.page?.next) {
      directory.polling = true;
      directory.live = false;
      changed();
      await options.wait(Math.min(5000 * 2 ** failures, 30000));
      if (!active()) return;
      if (!options.canRefresh()) continue;
      try {
        const pending = directory.refresh(
          options.fetchPage,
          () => active() && options.canRefresh(),
        );
        changed();
        if (await pending) failures = 0;
      } catch (error) {
        if (!active()) return;
        options.failed?.(directory.error);
        failures = Math.min(failures + 1, 3);
        changed();
        if (error instanceof ApiError && [400, 401, 403, 404].includes(error.status)) {
          directory.polling = false;
          changed();
          return;
        }
      }
      if (active()) changed();
      continue;
    }
    directory.polling = false;
    try {
      const from = directory.prepareLive();
      await options.stream(from, (envelope) => {
        if (!active()) return;
        directory.apply(envelope);
        directory.error = "";
        failures = 0;
        changed();
      });
      if (!active()) return;
      directory.error = "集合流已断开，按最后完整源 revision 续接；不会拼接不完整基线。";
      failures++;
    } catch (error) {
      if (!active()) return;
      directory.error = `实时集合不可用，保留上次完整快照：${String(error)}`;
      if (error instanceof ApiError && [400, 401, 403, 404, 410, 429].includes(error.status))
        failures = 5;
      else failures++;
    }
    directory.live = false;
    directory.stale = true;
    options.failed?.(directory.error);
    changed();
    if (failures >= 5) return;
    await options.wait(1000);
  }
}
