import { appendFile, copyFile, mkdir, readFile } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist/public", { recursive: true });
await build({
  entryPoints: ["src/browser.ts"],
  outfile: "dist/public/app.js",
  bundle: true,
  platform: "browser",
  target: "es2022",
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
});
await copyFile("src/index.html", "dist/public/index.html");
await appendFile(
  "dist/public/app.js",
  `\n/*!\nshadcn/ui shadcn@4.23.0, 96da9cc7f1aa10580a3741664e2a77c721206c00\n${await readFile("src/ui/LICENSE", "utf8")}\n*/\n`,
);
