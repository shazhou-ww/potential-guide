import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const staging = join(root, ".staging");
await mkdir(join(root, ".cache"), { recursive: true });
const scratch = await mkdtemp(join(root, ".cache", "worker-cache-proof-"));
const backup = join(scratch, "staging");
let moved = false;
let verified = false;
async function compare(before, after) {
  const entries = await readdir(before, { withFileTypes: true });
  assert.deepEqual((await readdir(after)).sort(), entries.map(({ name }) => name).sort());
  for (const entry of entries) {
    if (entry.isDirectory()) await compare(join(before, entry.name), join(after, entry.name));
    else
      assert.deepEqual(
        await readFile(join(before, entry.name)),
        await readFile(join(after, entry.name)),
        join(after, entry.name),
      );
  }
}
try {
  await rename(staging, backup);
  moved = true;
  execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["run", "build"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  await compare(backup, staging);
  verified = true;
  console.log("All staged worker resources restored byte-for-byte from build cache.");
} finally {
  if (moved && !verified) {
    await rm(staging, { recursive: true, force: true });
    await rename(backup, staging);
  }
  await rm(scratch, { recursive: true, force: true });
}
