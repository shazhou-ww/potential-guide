import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export async function buildEvidenceRuntime(packageName) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const source = await readFile(
    join(root, "packages", "objective-pilot", "src", "evidence.ts"),
    "utf8",
  );
  const text =
    "// Generated from objective-pilot/src/evidence.ts. Do not edit.\n" +
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText;
  const directory = join(root, ".staging", packageName, "runtime");
  const path = join(directory, "evidence.mjs");
  if (process.argv.includes("--check")) {
    if ((await readFile(path, "utf8")).replaceAll("\r\n", "\n") !== text)
      throw new Error(`Stale ${packageName} evidence runtime; rebuild its runtime.`);
  } else {
    await mkdir(directory, { recursive: true });
    await writeFile(path, text);
  }
}
