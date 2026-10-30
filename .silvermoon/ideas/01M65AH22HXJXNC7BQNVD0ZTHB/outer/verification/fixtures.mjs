import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { checkerSchemaUri, objectiveSchemaUri } from "@potential-guide/check-artifacts/contracts";
import { writeContractArtifact, packContractArtifact } from "@potential-guide/check-artifacts/build";

const page = Buffer.from("---\ntitle: External Probe\ndescription: Independent fixture\n---\nBody\n");
const origin = "https://probe-deployment.invalid";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function fixtures() {
  const directory = resolve("fixtures");
  await mkdir(directory);
  const artifacts = {};
  const routes = {};
  const checkerSource = await readFile("checker.cjs", "utf8");
  async function author(name, files, kind) {
    const built = await writeContractArtifact(files, join(directory, name));
    const packed = await packContractArtifact(built.directory, join(directory, `${name}.tgz`));
    const url = `${origin}/${name}.tgz`;
    const artifact = {
      kind, url, digest: built.digest, archive: packed.archive,
      transportDigest: packed.transportDigest, archiveSha256: sha(await readFile(packed.archive)),
      files: Object.fromEntries([...files].map(([name, bytes]) => [name, sha(bytes)])),
    };
    artifacts[name] = artifact;
    routes[url] = artifact.archive;
    return artifact;
  }
  for (const role of ["pass-a", "pass-b", "gap", "dynamic", "leaf", "control"]) {
    await author(`checker-${role}`, new Map([
      ["checker.yaml", Buffer.from(JSON.stringify({
        $schema: checkerSchemaUri, runtime: { type: "node", minVersion: "22.13.0" },
        entry: "checker.cjs", subjectSchema: { type: "object" }, languages: ["en"], problems: ["bad"],
      }))],
      ["checker.cjs", Buffer.from(checkerSource.replace("__ROLE__", role))],
      ["references/en/checker.md", page], ["references/en/problems/bad.md", page],
    ]), "checker");
  }
  const edge = (role) => ({
    url: artifacts[`checker-${role}`].url, digest: artifacts[`checker-${role}`].digest, subjectMapping: "$",
  });
  async function objective(name, levels, checkers) {
    return author(name, new Map([
      ["objective.yaml", Buffer.from(JSON.stringify({
        $schema: objectiveSchemaUri, subjectSchema: { type: "object" }, languages: ["en"], levels, checkers,
      }))],
      ["references/en/objective.md", page],
      ...levels.map((level) => [`references/en/levels/${level.id}.md`, page]),
    ]), "objective");
  }
  await objective("cumulative", [
    { id: "basic", checks: ["a", "b"] }, { id: "strict", checks: ["a", "gap"] }, { id: "unused", checks: ["b"] },
  ], { a: edge("pass-a"), b: edge("pass-b"), gap: edge("gap") });
  await objective("dynamic", [{ id: "ready", checks: ["dynamic"] }], { dynamic: edge("dynamic") });
  await objective("dependency", [{ id: "ready", checks: ["leaf"] }], { leaf: edge("leaf") });
  await objective("control", [{ id: "ready", checks: ["control"] }], { control: edge("control") });
  await objective("replacement", [{ id: "changed", checks: ["control"] }], { control: edge("control") });
  await writeFile("routes.json", JSON.stringify(routes, null, 2));
  return { artifacts, routes, sourceMode: "authorized-HTTPS-identities-with-trusted-fixture-downloader-no-network-service" };
}
export function body(artifact, name, fields = {}, rootFields = {}) {
  return {
    type: "probe", objective: { kind: "objective", url: artifact.url, digest: artifact.digest },
    subject: { name, journal: resolve("execution.jsonl"), mode: "pass", ...fields },
    timeoutMs: 90_000, ...rootFields,
  };
}
