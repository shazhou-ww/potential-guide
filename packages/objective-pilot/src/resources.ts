import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ObjectiveConfigurationError,
  type PageResource,
  type ResourceResolver,
} from "@potential-guide/pilot-protocol";

export * from "@potential-guide/pilot-protocol/resources";
export const fileResources: ResourceResolver = {
  version: "working-tree",
  async readText(uri) {
    if (new URL(uri).protocol !== "file:")
      throw new ObjectiveConfigurationError(`Unsupported resource URI: ${uri}.`);
    return new TextDecoder("utf-8", { fatal: true }).decode(await readFile(fileURLToPath(uri)));
  },
  async readPages(sourceUri) {
    if (new URL(sourceUri).protocol !== "file:")
      throw new ObjectiveConfigurationError(`Unsupported References URI: ${sourceUri}.`);
    const root = fileURLToPath(sourceUri);
    const rootMetadata = await lstat(root);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw new ObjectiveConfigurationError("References source must be a regular directory.");
    }
    const pages: PageResource[] = [];
    async function walk(path: string) {
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink())
        throw new ObjectiveConfigurationError(`References cannot follow symlinks: ${path}.`);
      if (metadata.isDirectory()) {
        for (const name of (await readdir(path)).sort()) await walk(join(path, name));
      } else if (metadata.isFile() && path.endsWith(".md")) {
        pages.push({
          uri: pathToFileURL(path).href,
          source: new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)),
        });
      } else {
        throw new ObjectiveConfigurationError(`Invalid References resource: ${path}.`);
      }
    }
    await walk(root);
    return pages;
  },
};
