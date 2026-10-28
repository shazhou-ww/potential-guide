import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildCheckArtifact, packCheckArtifact } from "../../dist/build.js";

const path = (name) => fileURLToPath(new URL(name, import.meta.url));
const outDirectory = path("../../.cache/file-content");
const built = await buildCheckArtifact({
  entry: path("worker.ts"),
  manifest: JSON.parse(await readFile(path("check.json"), "utf8")),
  files: {
    "resources/expected.txt": path("expected.txt"),
    "references/check.md": path("references/check.md"),
    "references/content-mismatch.md": path("references/content-mismatch.md"),
  },
  outDirectory,
});
console.log(await packCheckArtifact(built.directory, path("../../.cache/file-content.tgz")));
