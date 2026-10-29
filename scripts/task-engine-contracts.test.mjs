import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
test("generic task production dependency graph is acyclic and business/adapter independent", async () => {
  for (const name of ["task-protocol", "task-engine", "task-engine-http", "task-engine-storage"]) {
    const directory = join(root, "packages", name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    assert.deepEqual(
      Object.keys(manifest.dependencies ?? {}),
      name === "task-protocol" ? [] : ["@potential-guide/task-protocol"],
    );
    const files = await readdir(join(directory, "src"), { recursive: true });
    for (const file of files.filter((entry) => entry.endsWith(".ts"))) {
      const path = join(directory, "src", file);
      const source = ts.createSourceFile(
        path,
        await readFile(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      function inspect(node) {
        let specifier;
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        )
          specifier = node.moduleSpecifier.text;
        if (
          ts.isCallExpression(node) &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0]) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            node.expression.getText(source) === "require")
        )
          specifier = node.arguments[0].text;
        if (specifier) {
          if (specifier.startsWith("."))
            assert.ok(
              !relative(directory, resolve(dirname(path), specifier)).startsWith(".."),
              path,
            );
          else
            assert.ok(
              specifier === "@potential-guide/task-protocol" ||
                (name !== "task-protocol" && specifier.startsWith("node:")),
              `${path}: ${specifier}`,
            );
        }
        ts.forEachChild(node, inspect);
      }
      inspect(source);
    }
  }
});
