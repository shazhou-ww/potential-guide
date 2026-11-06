import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import spawn from "cross-spawn";

export const generatedSources = ["pguide-cli-core/src/built-in-settings.ts"];

export async function guardGeneratedSources(root, build) {
  const snapshots = await Promise.all(
    generatedSources.map(async (file) => {
      const path = join(root, "packages", file);
      return { path, bytes: await readFile(path) };
    }),
  );
  try {
    await build();
    for (const { path, bytes } of snapshots)
      assert.ok(
        (await readFile(path, "utf8")).replaceAll("\r\n", "\n") ===
          bytes.toString().replaceAll("\r\n", "\n"),
        `Generated source drift: ${path}; run pnpm build explicitly and review generated changes.`,
      );
  } finally {
    for (const { path, bytes } of snapshots) await writeFile(path, bytes);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  await guardGeneratedSources(root, () => {
    const result = spawn.sync("pnpm", ["run", "build"], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "Build failed while validating generated sources.");
  });
}
