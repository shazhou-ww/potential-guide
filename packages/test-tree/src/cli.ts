import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadTree } from "./model.js";
import { renderHtml, renderMarkdown, renderTerminal } from "./render.js";

async function main() {
  const [file, format, output, ...extra] = process.argv.slice(2);
  if (!file || !format || extra.length || !["tree", "markdown", "html"].includes(format))
    throw new Error("Usage: manual <tree.yaml> <tree|markdown|html> [output-file]");
  const loaded = await loadTree(file);
  if (output && [loaded.file, loaded.bindingFile].includes(resolve(output)))
    throw new Error("Output must not overwrite YAML or its binding");
  const rendered =
    format === "tree"
      ? renderTerminal(loaded)
      : format === "markdown"
        ? renderMarkdown(loaded)
        : renderHtml(loaded);
  if (output) await writeFile(output, rendered, { flag: "wx" });
  else process.stdout.write(rendered);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
