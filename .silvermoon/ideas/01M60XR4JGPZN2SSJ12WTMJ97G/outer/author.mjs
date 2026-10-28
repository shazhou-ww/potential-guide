import { createServer } from "node:https";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildCheckArtifact, packCheckArtifact } from "@potential-guide/check-artifacts/build";
import { closePrivateFileBackend } from "@potential-guide/check-host";
import { inspectObjectiveArtifact, objectiveArtifactLocation, objectiveArtifactSchemaUri } from "@potential-guide/cli-runtime";

const root = process.cwd();
const control = resolve("control");
await mkdir(control);
await mkdir("author-input");
await mkdir("delivery");
const products = {};
for (const version of ["V2", "V3"]) {
  const configuration = join(root, "author-input", `${version}.json`);
  const reference = join(root, "author-input", `${version}.md`);
  await writeFile(configuration, JSON.stringify({ version, control }));
  await writeFile(reference, `# ${version} exact Check Reference\n`);
  const built = await buildCheckArtifact({
    entry: resolve("controlled-worker.cjs"), outDirectory: resolve("delivery", version),
    manifest: {
      format: "pguide-check-v1", id: "deployment-controlled", version,
      worker: "worker.cjs", protocol: "pguide-check-host-v1",
      subjectSchema: { type: "object", required: ["name"] },
      resultSchema: { type: "object", required: ["ok", "version", "worker", "invocation"] },
      resources: [{ path: "resources/control.json", executable: false }],
      references: { check: "references/check.md", problems: {} },
    },
    files: { "resources/control.json": configuration, "references/check.md": reference },
  });
  const archive = resolve("delivery", `${version}.tgz`);
  const packed = await packCheckArtifact(built.directory, archive);
  products[version] = { digest: built.digest, transportDigest: packed.transportDigest, archive };
}
for (const version of ["business", "business-next"]) {
  const reference = resolve("author-input", `${version}.md`);
  const problem = resolve("author-input", "not-ready.md");
  await writeFile(reference, `# ${version} owning Check Reference\n`);
  await writeFile(problem, "# Not ready\nExplicit readiness evidence is required.\n");
  const built = await buildCheckArtifact({
    entry: resolve("business-worker.cjs"), outDirectory: resolve("delivery", version),
    manifest: {
      format: "pguide-check-v1", id: "deployment-business", version,
      worker: "worker.cjs", protocol: "pguide-check-host-v1",
      subjectSchema: { type: "object", required: ["ready"], additionalProperties: false,
        properties: { ready: { type: "boolean" } } },
      resultSchema: { type: "object", required: ["status", "payload", "message"],
        properties: { status: { const: 200 }, payload: { type: "object" }, message: { type: "string" } } },
      resources: [], references: { check: "references/check.md", problems: { "not-ready": "references/not-ready.md" } },
    },
    files: { "references/check.md": reference, "references/not-ready.md": problem },
  });
  const archive = resolve("delivery", `${version}.tgz`);
  const packed = await packCheckArtifact(built.directory, archive);
  products[version] = { digest: built.digest, transportDigest: packed.transportDigest, archive };
}
const downloads = { V2: 0, V3: 0, business: 0, "business-next": 0 };
const bytes = Object.fromEntries(await Promise.all(Object.entries(products).map(async ([name, product]) =>
  [name, await readFile(product.archive)])));
const https = createServer({ cert: await readFile("cert.pem"), key: await readFile("key.pem") }, (request, response) => {
  const name = request.url === "/latest" ? (existsSync(join(control, "latest-v3")) ? "V3" : "V2") :
    request.url === "/business" ? (existsSync(join(control, "business-next")) ? "business-next" : "business") : undefined;
  if (!name) { response.writeHead(404); response.end(); return; }
  downloads[name]++;
  response.writeHead(200, { "content-type": "application/gzip" });
  response.end(bytes[name]);
});
await new Promise(resolve => https.listen(0, "127.0.0.1", resolve));
const origin = `https://127.0.0.1:${https.address().port}`;
const objective = resolve("delivery", "objective");
await mkdir(join(objective, "references"), { recursive: true });
await writeFile(join(objective, "references", "overview.md"), "# Independent Host v2 Objective\n");
const page = { path: "references/overview.md", title: "Host v2 readiness", description: "Exact fixed Check" };
await writeFile(join(objective, "objective.json"), JSON.stringify({
  $schema: objectiveArtifactSchemaUri, id: "objective:host-v2-delivery",
  subjectSchema: { type: "object", required: ["ready"], additionalProperties: false,
    properties: { ready: { type: "boolean" } } },
  levels: [{ id: "ready", checks: [{ id: "ready", problems: ["not-ready"] }] }],
  defaultLanguage: "en", languages: ["en"],
  checks: { ready: { source: { kind: "https", url: `${origin}/business`,
    digest: products.business.digest, transportDigest: products.business.transportDigest },
    subject: '{"ready":ready}' } },
  dependencies: {}, resources: [],
  references: { "system/overview": { en: page }, "system/404": { en: page }, "levels/ready": { en: page } },
}));
const inspected = await inspectObjectiveArtifact(objective);
await writeFile("delivery.json", JSON.stringify({
  origin, products, objective: { directory: objective, digest: inspected.digest,
    location: objectiveArtifactLocation(objective, inspected.digest) },
  certificateSha256: createHash("sha256").update(await readFile("cert.pem")).digest("hex"),
}));
console.log(JSON.stringify({ ready: true, origin }));
await new Promise(resolve => { process.stdin.once("data", resolve); process.stdin.once("end", resolve); });
https.closeAllConnections();
await new Promise(resolve => https.close(resolve));
await closePrivateFileBackend();
await writeFile("author-results.json", JSON.stringify({ downloads, serverClosed: !https.listening }));
