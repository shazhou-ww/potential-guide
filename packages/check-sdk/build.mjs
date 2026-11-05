import { copyFile, readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prepareCheck, validateReference } from "./dist/authoring.js";

const root = new URL(".", import.meta.url);
for (const name of ["check-result", "check-callback"]) {
  const path = new URL(`references/en/${name}.md`, root);
  validateReference(await readFile(path), fileURLToPath(path));
}
const pages = await readdir(new URL("references/en/", root));
if (pages.sort().join(",") !== "check-callback.md,check-result.md")
  throw new Error("Unexpected public Check Reference page.");
const languages = await readdir(new URL("references/", root));
if (languages.join(",") !== "en") throw new Error("Unexpected public Reference language.");
await prepareCheck(fileURLToPath(new URL("examples/text/text.check.build.yaml", root)));
await copyFile(new URL("../../LICENSE", root), new URL("LICENSE", root));
