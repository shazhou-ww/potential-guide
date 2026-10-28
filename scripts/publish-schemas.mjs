import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const schemaBase = "https://shazhou-ww.github.io/potential-guide/";
export async function collectSchemas(root) {
  const schemas = new Map();
  async function visit(parts) {
    for (const entry of await readdir(join(root, "schemas", ...parts), { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(entry.name) &&
        parts.length < 4
      ) {
        await visit([...parts, entry.name]);
        continue;
      }
      if (!entry.isFile() || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(entry.name))
        throw new Error(`Unexpected schema source: ${[...parts, entry.name].join("/")}`);
      const path = ["schemas", ...parts, entry.name].join("/");
      const bytes = await readFile(join(root, ...path.split("/")));
      const schema = JSON.parse(bytes);
      if (
        schema.$id !== `${schemaBase}${path}` ||
        schema.$schema !== "https://json-schema.org/draft/2020-12/schema"
      )
        throw new Error(`Schema identity/dialect mismatch: ${path}`);
      schemas.set(path, bytes);
    }
  }
  await visit([]);
  return schemas;
}

export async function assertImmutableSchemas(schemas, request = fetch) {
  const get = async (path) => {
    const response = await request(`${schemaBase}${path}`, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (response.status === 404) return undefined;
    if (!response.ok)
      throw new Error(`Cannot verify published schema ${path}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const published = await get("schemas/index.json");
  const publishedPaths = new Set();
  if (published) {
    const index = JSON.parse(published.toString());
    if (
      !Array.isArray(index) ||
      !index.every(
        (path) =>
          typeof path === "string" &&
          /^schemas\/(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/){1,4}[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(
            path,
          ),
      )
    )
      throw new Error("Invalid published schema index; refusing deployment.");
    for (const path of index) {
      publishedPaths.add(path);
      if (!schemas.has(path))
        throw new Error(`Cannot remove published schema ${path}; add a new URI instead.`);
    }
  }
  for (const [path, bytes] of schemas) {
    const existing = await get(path);
    if (publishedPaths.has(path) && !existing)
      throw new Error(
        `Previously published schema is unavailable: ${path}; refusing to replace missing evidence.`,
      );
    if (existing && !bytes.equals(existing))
      throw new Error(
        `Published definition is immutable: ${path}. Publish changes under a new URI.`,
      );
  }
}

export async function buildSchemaSite(root, destination) {
  const schemas = await collectSchemas(root);
  await assertImmutableSchemas(schemas);
  for (const [path, bytes] of schemas) {
    const target = join(destination, ...path.split("/"));
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, bytes);
    console.log(`${createHash("sha256").update(bytes).digest("hex")}  ${path}`);
  }
  await writeFile(
    join(destination, "schemas", "index.json"),
    `${JSON.stringify([...schemas.keys()].sort(), null, 2)}\n`,
  );
  await writeFile(join(destination, ".nojekyll"), "");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, "..");
  await buildSchemaSite(root, join(root, ".cache", "schema-site"));
}
