import assert from "node:assert/strict";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { checkMvpConsumer } from "./check-mvp-consumer.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
test("retired Probe authoring is rejected before creating an output directory", async () => {
  const path = join(root, "examples", "task-server", "build-bundles.mjs");
  const source = ts.createSourceFile(
    path,
    await readFile(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "buildExampleBundle",
  );
  assert.ok(declaration);
  const buildExampleBundle = new Function(
    "mkdir",
    `return (${declaration
      .getText(source)
      .replace(/^export /, "")
      .replaceAll("import.meta.url", JSON.stringify(pathToFileURL(path).href))});`,
  )(async () => assert.fail("Retired authoring must not create output."));
  const scratch = await mkdtemp(join(tmpdir(), "pguide-retired-probe-"));
  const directory = join(scratch, "author");
  try {
    await assert.rejects(
      buildExampleBundle({ kind: "probe", directory }),
      /Unknown example callback/,
    );
    await assert.rejects(access(directory), { code: "ENOENT" });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("generic packed server rejects Check and authoring runtime dependencies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pguide-server-dependency-"));
  try {
    for (const name of [
      "@potential-guide/artifact-files",
      "@potential-guide/check-artifacts",
      "@potential-guide/check-runtime-files",
      "@potential-guide/task-sdk",
      "@potential-guide/check-task",
      "@potential-guide/probe-task",
    ])
      await assert.rejects(
        checkMvpConsumer(root, directory, "mvp-server", [{ name }], async () => {
          throw new Error("Forbidden dependency reached consumer execution.");
        }),
        /Generic Task server must not install/,
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generic task production dependency graph is acyclic and business/adapter independent", async () => {
  for (const name of [
    "task-protocol",
    "task-engine",
    "task-engine-http",
    "task-engine-storage",
    "task-engine-server",
  ]) {
    const directory = join(root, "packages", name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const dependencies =
      name === "task-engine-server"
        ? [
            "@potential-guide/task-protocol",
            "@potential-guide/task-engine",
            "@potential-guide/task-engine-http",
            "@potential-guide/task-engine-storage",
          ]
        : name === "task-engine"
          ? [
              "@helia/http",
              "@helia/unixfs",
              "@helia/block-brokers",
              "@helia/routers",
              "blockstore-core",
              "multiformats",
              "ipfs-unixfs-exporter",
              "ipfs-unixfs-importer",
              "@potential-guide/task-protocol",
              "semver",
            ]
          : name === "task-protocol"
            ? ["multiformats", "ajv", "yaml"]
            : ["@potential-guide/task-protocol"];
    assert.deepEqual(Object.keys(manifest.dependencies ?? {}), dependencies);
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
              dependencies.some(
                (dependency) => specifier === dependency || specifier.startsWith(`${dependency}/`),
              ) ||
                (name === "task-protocol" &&
                  ["node:crypto", "ajv/dist/2020.js"].includes(specifier)) ||
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
