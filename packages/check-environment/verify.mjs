import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCheckResources } from "@potential-guide/check-sdk/authoring";
import { readTaskArtifact } from "@potential-guide/pguide-task-bundle/artifact";
import { prepareEnvironment } from "./prepare.mjs";
import { acceptChecks, readReferences } from "./build.mjs";

/** Uncached acceptance boundary, also run before packing restored build outputs. */
export async function verifyEnvironment(root, acceptedOnly = false) {
  const checks = await prepareEnvironment(root);
  if (!acceptedOnly) return acceptChecks(root, checks);
  const references = await readReferences(join(root, "dist", "bundles"), checks);
  for (const check of checks) {
    const reference = references[check.kind];
    for (const path of [reference.car, reference.directory]) {
      const artifact = await readTaskArtifact(join(root, "dist/bundles", path), reference.cid);
      verifyCheckResources(check, artifact.files);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv.slice(2).find((argument) => argument !== "--accepted");
  await verifyEnvironment(
    root ? resolve(root) : fileURLToPath(new URL(".", import.meta.url)),
    process.argv.includes("--accepted"),
  );
}
