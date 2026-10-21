import assert from "node:assert/strict";
import { appendFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(dirname(fileURLToPath(import.meta.url)));
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url.startsWith("file:")) {
      const path = realpathSync(fileURLToPath(result.url));
      const local = relative(root, path);
      assert.ok(
        !isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`),
        `Module escaped isolated consumer: ${path}`,
      );
      appendFileSync(
        join(root, "module-resolutions.jsonl"),
        `${JSON.stringify({ specifier, path })}\n`,
      );
    }
    return result;
  },
});
