import { copyFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist/public", { recursive: true });
await build({
  entryPoints: ["src/browser.ts"],
  outfile: "dist/public/app.js",
  bundle: true,
  platform: "browser",
  target: "es2022",
});
for (const name of ["index.html", "style.css"]) {
  await copyFile(`src/${name}`, `dist/public/${name}`);
}
