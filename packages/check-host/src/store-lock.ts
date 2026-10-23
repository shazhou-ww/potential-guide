let mutations: Promise<unknown> = Promise.resolve();

/** The caller supplies an already-created, validated private file that is never unlinked. */
export function withFileMutex<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const task = mutations.then(async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const guard = new DatabaseSync(path);
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          // No tables, task state or database writes; OS locks release on process death.
          guard.exec("BEGIN EXCLUSIVE");
          break;
        } catch (error) {
          if (![5, 6].includes((error as { errcode: number }).errcode)) throw error;
          if (attempt >= 39)
            throw Object.assign(new Error("Private Host store is busy."), { code: "EBUSY" });
          await new Promise((done) => setTimeout(done, 25));
        }
      }
      try {
        return await operation();
      } finally {
        guard.exec("ROLLBACK");
      }
    } finally {
      guard.close();
    }
  });
  mutations = task.catch(() => {});
  return task;
}
