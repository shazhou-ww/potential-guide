import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const ranks = { protocol: 0, business: 1, tools: 2 };
const fields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

export function classify(policy, names) {
  const layers = new Map();
  const errors = [];
  for (const [layer, members] of Object.entries(policy)) {
    if (!(layer in ranks) && layer !== "deferredExternalization") {
      errors.push(`Unknown layer ${layer}.`);
      continue;
    }
    for (const name of members) {
      if (layers.has(name)) errors.push(`Duplicate package classification: ${name}.`);
      layers.set(name, layer);
      if (!names.includes(name)) errors.push(`Classified package is absent: ${name}.`);
    }
  }
  for (const name of names) {
    if (!layers.has(name)) errors.push(`Unclassified package: ${name}.`);
  }
  return { layers, errors };
}

export function allowed(layers, from, to) {
  const source = layers.get(from);
  const target = layers.get(to);
  if (source === undefined || target === undefined) return false;
  if (source === "deferredExternalization") return true;
  if (target === "deferredExternalization") {
    return source === "tools" && to === "@potential-guide/git-source";
  }
  return ranks[source] >= ranks[target];
}

export function imports(source, filename = "source.ts") {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const result = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      result.push(node.arguments[0].text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    )
      result.push(node.argument.literal.text);
    if (
      ts.isExternalModuleReference(node) &&
      node.expression &&
      ts.isStringLiteralLike(node.expression)
    )
      result.push(node.expression.text);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return result;
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", "test", ".cache", ".turbo"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) files.push(path);
  }
  return files;
}

export async function checkLayers(directory = root) {
  const policy = JSON.parse(
    await readFile(join(directory, "config", "package-layers.json"), "utf8"),
  );
  const packages = [];
  for (const base of ["packages", "apps"]) {
    let entries;
    try {
      entries = await readdir(join(directory, base), { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries.filter((entry) => entry.isDirectory())) {
      const path = join(directory, base, entry.name);
      const manifest = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
      packages.push({ path, manifest });
    }
  }
  const { layers, errors } = classify(
    policy,
    packages.map(({ manifest }) => manifest.name),
  );
  const names = [...layers.keys()].sort((a, b) => b.length - a.length);
  function target(specifier, file) {
    if (specifier.startsWith(".") || isAbsolute(specifier) || specifier.startsWith("file:")) {
      const path = specifier.startsWith("file:")
        ? fileURLToPath(specifier)
        : resolve(dirname(file), specifier);
      return packages.find((pkg) => {
        const inside = relative(pkg.path, path);
        return (
          inside === "" ||
          (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside))
        );
      })?.manifest.name;
    }
    return names.find((name) => specifier === name || specifier.startsWith(`${name}/`));
  }
  for (const pkg of packages) {
    const name = pkg.manifest.name;
    const configuration = ts.readConfigFile(join(pkg.path, "tsconfig.json"), ts.sys.readFile);
    const options = configuration.error
      ? {}
      : ts.parseJsonConfigFileContent(configuration.config, ts.sys, pkg.path).options;
    const resolutionCache = ts.createModuleResolutionCache(directory, (path) => path, options);
    function check(to, location) {
      if (to && to !== name && !allowed(layers, name, to)) {
        errors.push(`${name} -> ${to}: forbidden dependency (${location}).`);
      }
    }
    for (const field of fields) {
      for (const [dependency, version] of Object.entries(pkg.manifest[field] ?? {})) {
        check(target(dependency, join(pkg.path, "package.json")), field);
        if (version.startsWith("npm:")) {
          const alias = version.slice(4);
          const versionIndex = alias.lastIndexOf("@");
          check(
            target(
              versionIndex > 0 ? alias.slice(0, versionIndex) : alias,
              join(pkg.path, "package.json"),
            ),
            field,
          );
        }
        if (version.startsWith("file:") || version.startsWith("link:")) {
          check(
            target(
              resolve(pkg.path, version.slice(version.indexOf(":") + 1)),
              join(pkg.path, "package.json"),
            ),
            field,
          );
        }
      }
    }
    for (const file of await walk(pkg.path)) {
      for (const specifier of imports(await readFile(file, "utf8"), file)) {
        let dependency = target(specifier, file);
        if (!dependency && (options.paths || specifier.startsWith("#"))) {
          const resolved = ts.resolveModuleName(specifier, file, options, ts.sys, resolutionCache)
            .resolvedModule?.resolvedFileName;
          if (resolved) dependency = target(resolve(resolved), file);
        }
        check(dependency, relative(directory, file));
      }
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = await checkLayers();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("Package layers: all manifests and production imports are valid.");
}
