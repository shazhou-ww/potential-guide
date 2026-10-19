import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

async function check(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".turbo", "test"].includes(item.name)) continue;
    const path = join(directory, item.name);
    if (item.isDirectory()) await check(path);
    else if (/\.(?:mjs|cjs)$/.test(item.name))
      execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  }
}
await check(process.cwd());
