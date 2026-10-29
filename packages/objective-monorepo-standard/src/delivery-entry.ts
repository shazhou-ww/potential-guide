import type { Delivery, Workspace } from "./contract.js";
import { sourceImports } from "./imports.js";
import type { ReportPut } from "./shared.js";
import { isNodeImport, resolveSource, type Snapshot, under } from "./shared.js";

export async function checkDeliveryEntry(
  snapshot: Snapshot,
  delivery: Delivery,
  owner: Workspace,
  put: ReportPut,
) {
  const ownerPath = owner.path;
  if (delivery.runtime === "browser" || delivery.runtime === "worker") {
    const seen = new Set<string>();
    async function inspect(path: string): Promise<void> {
      if (seen.has(path)) return;
      seen.add(path);
      if (seen.size > 1000) {
        put(
          "unverified",
          "entry-runtime",
          "Entry import graph exceeds 1,000 files.",
          "Narrow or extend the runtime observer.",
          path,
        );
        return;
      }
      let source: string;
      try {
        source = await snapshot.text(path);
      } catch {
        put(
          "unverified",
          "entry-runtime",
          "Referenced entry source cannot be inspected.",
          "Provide a readable source/build mapping.",
          path,
        );
        return;
      }
      for (const { specifier, typeOnly } of sourceImports(path, source)) {
        if (typeOnly) continue;
        if (specifier === null) {
          put(
            "unverified",
            "computed-import",
            "Delivery entry contains an unresolved computed import.",
            "Use a supported static entry mapping.",
            path,
          );
          continue;
        }
        if (isNodeImport(specifier) || /(?:server-only|secrets?)(?:\/|$)/.test(specifier)) {
          put(
            delivery.runtime === "browser" ? "fail" : "unverified",
            "entry-runtime",
            "Delivery entry transitively imports a server-only module.",
            "Remove it from browser paths or separately verify Worker compatibility.",
            path,
          );
        }
        if (specifier.startsWith(".")) {
          const candidate = await resolveSource(snapshot, path, specifier);
          if (candidate && under(candidate, ownerPath)) await inspect(candidate);
          else
            put(
              "unverified",
              "entry-source-mapping",
              "A relative entry import could not be resolved by the supported JS/TS mapping.",
              "Validate the tool-specific alias/extension mapping.",
              path,
            );
        }
      }
    }
    await inspect(`${owner.path}/${delivery.entry.path}`);
  }
}
