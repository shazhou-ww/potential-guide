import { sourceImports } from "./imports.js";
import type { Snapshot } from "./shared.js";

export async function observeSourceImports(snapshot: Snapshot, path: string) {
  return sourceImports(path, await snapshot.text(path));
}
