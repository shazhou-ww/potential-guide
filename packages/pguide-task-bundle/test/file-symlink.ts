import fs from "node:fs/promises";
import type { TestContext } from "node:test";

export async function fileSymlink(t: Pick<TestContext, "skip">, target: string, path: string) {
  try {
    await fs.symlink(target, path, "file");
    return true;
  } catch (error) {
    if (
      process.platform !== "win32" ||
      !(error instanceof Error) ||
      !("code" in error) ||
      (error.code !== "EPERM" && error.code !== "EACCES")
    )
      throw error;
    t.skip(
      `Windows file symlink creation denied (${error.code}); enable Developer Mode or run with symlink privileges to exercise this case.`,
    );
    return false;
  }
}
