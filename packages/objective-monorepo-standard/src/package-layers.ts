import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parseDocument } from "yaml";
import { sourceImports } from "./imports.js";
import { recorder } from "./report.js";
import { observeRepository, type RepositoryFacts } from "./repository-observation.js";
import { type Add, ajv, dependencyGroups, Snapshot, under } from "./shared.js";
import { typeScriptHost } from "./typescript-host.js";

const ranks = { protocol: 0, business: 1, tools: 2 };
type Layer = keyof typeof ranks | "deferredExternalization";
type Policy = Record<Layer, string[]>;
const validator = ajv.compile<Policy>({
  type: "object",
  additionalProperties: false,
  required: Object.keys(ranks),
  properties: Object.fromEntries(
    [...Object.keys(ranks), "deferredExternalization"].map((layer) => [
      layer,
      { type: "array", items: { type: "string", minLength: 1 } },
    ]),
  ),
});

export function classify(policy: Policy, names: string[]) {
  const layers = new Map<string, Layer>();
  const errors: string[] = [];
  for (const layer of [...Object.keys(ranks), "deferredExternalization"] as Layer[]) {
    for (const name of policy[layer] ?? []) {
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

export function allowed(layers: Map<string, Layer>, from: string, to: string) {
  const source = layers.get(from);
  const target = layers.get(to);
  if (source === undefined || target === undefined) return false;
  if (source === "deferredExternalization") return true;
  if (target === "deferredExternalization")
    return source === "tools" && to === "@potential-guide/git-source";
  return ranks[source] >= ranks[target];
}

export async function observePackageLayers(
  snapshot: Snapshot,
  facts: RepositoryFacts,
  policyPath: string,
  add: Add,
) {
  const remedy = "Correct the declared package layers or remove the forbidden upward dependency.";
  const fail = (rule: string, location: string, evidence: string, packages: string[] = []) =>
    add(1, "fail", rule, location, evidence, remedy, packages);
  let policy: Policy;
  try {
    const document = parseDocument(await snapshot.text(policyPath), { uniqueKeys: true });
    if (document.errors.length) throw new Error("Package layer policy has YAML parse errors.");
    const parsed: unknown = document.toJS();
    if (!validator(parsed))
      throw new Error(`Invalid package layer policy: ${ajv.errorsText(validator.errors)}`);
    policy = parsed;
  } catch (error) {
    fail("package-layer-policy", policyPath, String(error));
    return;
  }
  if (facts.failure || facts.packages.some((pkg) => !pkg.valid)) {
    fail(
      "package-layer-inventory",
      policyPath,
      facts.failure ?? "Invalid workspace manifests prevent complete layer classification.",
    );
    return;
  }
  const packages = facts.packages.map((pkg) => ({
    ...pkg,
    name: String(pkg.manifest.name),
    path: resolve(snapshot.root, pkg.directory),
  }));
  const { layers, errors } = classify(
    policy,
    packages.map((pkg) => pkg.name),
  );
  for (const error of errors) fail("package-layer-classification", policyPath, error);
  const names = [...layers.keys()].sort((a, b) => b.length - a.length);
  const host = await typeScriptHost(snapshot);
  function target(specifier: string, file: string) {
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
      })?.name;
    }
    return names.find((name) => specifier === name || specifier.startsWith(`${name}/`));
  }
  for (const pkg of packages) {
    if (layers.get(pkg.name) === "deferredExternalization") continue;
    const check = (to: string | undefined, location: string) => {
      if (to && to !== pkg.name && !allowed(layers, pkg.name, to))
        fail("package-layer-dependency", location, `${pkg.name} -> ${to}: forbidden dependency.`, [
          pkg.name,
          to,
        ]);
    };
    const manifestFile = `${pkg.directory}/package.json`;
    for (const { kind, name, version } of dependencyGroups(pkg.manifest)) {
      const location = `${manifestFile} (${kind})`;
      check(target(name, resolve(snapshot.root, manifestFile)), location);
      if (typeof version !== "string") continue;
      if (version.startsWith("npm:")) {
        const alias = version.slice(4);
        const versionIndex = alias.lastIndexOf("@");
        check(
          target(
            versionIndex > 0 ? alias.slice(0, versionIndex) : alias,
            resolve(snapshot.root, manifestFile),
          ),
          location,
        );
      }
      if (version.startsWith("file:") || version.startsWith("link:"))
        check(
          target(
            resolve(pkg.path, version.slice(version.indexOf(":") + 1)),
            resolve(snapshot.root, manifestFile),
          ),
          location,
        );
    }
    const configFile = `${pkg.directory}/tsconfig.json`;
    let options: ts.CompilerOptions = {};
    try {
      if (await snapshot.exists(configFile)) {
        const configuration = ts.parseConfigFileTextToJson(
          configFile,
          await snapshot.text(configFile),
        );
        if (configuration.error) throw new Error("Invalid TypeScript configuration.");
        const parsed = ts.parseJsonConfigFileContent(configuration.config, host, pkg.path);
        const errors = parsed.errors.filter(
          (error) => error.code !== 18002 && error.code !== 18003,
        );
        if (host !== ts.sys && errors.length)
          throw new Error(
            errors
              .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
              .join("\n"),
          );
        options = parsed.options;
      }
    } catch (error) {
      fail("package-layer-configuration", configFile, String(error), [pkg.name]);
      continue;
    }
    const cache = ts.createModuleResolutionCache(snapshot.root, (path) => path, options);
    const sources = facts.inventory.filter(
      (file) =>
        under(file, pkg.directory) &&
        /\.[cm]?[jt]sx?$/.test(file) &&
        !/(?:\/(?:test|tests|__tests__)\/|[.](?:test|spec)[.])/.test(file),
    );
    for (const file of sources) {
      try {
        for (const { specifier } of sourceImports(file, await snapshot.text(file))) {
          if (specifier === null) continue;
          const absolute = resolve(snapshot.root, file);
          let dependency = target(specifier, absolute);
          if (!dependency && (options.paths || specifier.startsWith("#"))) {
            const resolved = ts.resolveModuleName(specifier, absolute, options, host, cache)
              .resolvedModule?.resolvedFileName;
            if (resolved) dependency = target(resolve(resolved), absolute);
          }
          check(dependency, file);
        }
      } catch (error) {
        add(
          1,
          "unverified",
          "package-layer-source",
          file,
          String(error),
          "Restore safe, readable source files to verify architecture boundaries.",
          [pkg.name],
        );
      }
    }
  }
  add(1, "pass", "package-layer-policy", policyPath, "Package layer policy was inspected.", "");
}

export async function checkPackageLayers(root: string, policyPath = "package-layers.yaml") {
  const snapshot = await Snapshot.open(root);
  const output = recorder();
  await observePackageLayers(snapshot, await observeRepository(snapshot), policyPath, output.add);
  return output.report(1);
}
