import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const checking = process.argv.includes("--check");
async function emit(path, bytes) {
  if (checking) {
    if (!(await readFile(path)).equals(Buffer.from(bytes)))
      throw new Error(`Stale worker artifact: ${path}; run pnpm workers:build.`);
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
}
async function resources(source, destination) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isDirectory())
      await resources(join(source, entry.name), join(destination, entry.name));
    else if (entry.isFile())
      await emit(join(destination, entry.name), await readFile(join(source, entry.name)));
    else throw new Error("Worker resources must not contain links.");
  }
}
const common = `
function envelope(result) {
  if (result.status !== 200 || result.payload === null) throw new Error(result.message);
  return result;
}
`;
const jobs = [];
for (const scope of ["", "package-standard/"])
  for (const phase of ["structure", "deliveries"])
    jobs.push({
      package: scope ? "objective-package-standard" : "objective-monorepo-standard",
      directory: `checks/${phase}`,
      source: `
import { checkRepository, checkPackage, withDependencyResolutions, withInputView } from "./packages/objective-monorepo-standard/src/index.ts";
${common}
export async function execute(subject, context) {
  context.signal.throwIfAborted();
  return withDependencyResolutions(context.data.resolutions ?? [], () =>
    withInputView(context.data.inputView ?? undefined, async () => {
      const result = ${scope ? `{report: await checkPackage(subject, ${phase === "structure" ? 1 : 2})}` : `await checkRepository(subject, ${phase === "structure" ? 1 : 2}, undefined, context.signal)`};
      const problems = result.problems ?? (result.report.state === "pass" ? [] : [{kind:"internal", id:${JSON.stringify(phase === "structure" ? "structure-incomplete" : "delivery-incomplete")}, parameters:{report:result.report}}]);
      const requirements = result.requirements ?? [];
      return envelope({status:200,payload:{ok:!problems.length && !requirements.length,problems,...(requirements.length ? {requirements} : {})},message:JSON.stringify(result.report)});
    }));
}`,
    });
for (const stage of ["identity", "system", "toolchains", "order", "sustainability"])
  jobs.push({
    package: "objective-devbox-health",
    directory: `checks/${stage}`,
    source: `import { check } from "./packages/objective-devbox-health/src/runner.mjs";
${common}
export async function execute(subject, context) {
  return envelope(await check(${JSON.stringify(stage)}, subject, {signal:context.signal,deadline:context.deadline,environment:context.data.environment ?? {}}));
}`,
    resources: [["runtime/health-check.mjs", "health-check.mjs"]],
  });
for (const name of ["objective-pguide-setup", "objective-pguide-self-check"])
  for (const stage of ["installation", "configuration", "sanity"])
    jobs.push({
      package: name,
      directory: `checks/${stage}`,
      source: `      import { check } from "./${name === "objective-pguide-setup" ? `packages/${name}` : `.staging/${name}/runtime`}/src/runner.mjs";
${common}
export async function execute(subject, context) {
  return envelope(await check(${JSON.stringify(stage)},subject,{pilot:true,selfCheck:${name === "objective-pguide-self-check"},signal:context.signal,timeoutMs:context.data.timeoutMs,objectivePackages:context.data.objectivePackages ?? {},objectiveSources:context.data.objectiveSources ?? {},objectiveExecutables:context.data.objectiveExecutables ?? {},environment:context.data.environment ?? {}}));
}`,
      resourceTree: name === "objective-pguide-setup" ? undefined : "runtime",
    });
jobs.push({
  package: "objective-setup-marker",
  directory: "checks/marker",
  source: `import {lstat,readFile} from "node:fs/promises";
export async function execute({marker,expected},context) {
  context.signal.throwIfAborted();
  let ok=false;
  try {const details=await lstat(marker); ok=details.isFile() && !details.isSymbolicLink() && details.size===Buffer.byteLength(expected) && await readFile(marker,"utf8")===expected;}
  catch(error) {if(error.code!=="ENOENT") throw error;}
  return {status:200,message:"",payload:ok?{ok:true,problems:[]}:{ok:false,problems:[{kind:"internal",id:"marker-incorrect",parameters:{marker,expected,instruction:"Write exactly expected into marker (no newline). Do not modify other files."}}]}};
}`,
});
// The marker must be generated before setup copies its immutable fixture resources.
jobs.unshift(jobs.pop());
const selected = process.argv.indexOf("--package");
for (const job of jobs.filter(
  (job) => selected === -1 || job.package === process.argv[selected + 1],
)) {
  const packageRoot = join(root, ".staging", job.package);
  const directory = join(packageRoot, ...job.directory.split("/"));
  const result = await build({
    absWorkingDir: root,
    stdin: { contents: job.source, resolveDir: root, sourcefile: "worker-entry.mjs", loader: "js" },
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    minify: true,
    legalComments: "eof",
    write: false,
    define: { "import.meta.url": "__artifactURL" },
    banner: {
      js: '// Generated by scripts/build-check-workers.mjs. Do not edit.\nconst __artifactURL = require("node:url").pathToFileURL(__filename).href;',
    },
    alias: {
      "@potential-guide/objective-pilot": join(root, "packages/objective-pilot/src/index.ts"),
      "@potential-guide/pilot-protocol/projection": join(
        root,
        "packages/pilot-protocol/src/projection.ts",
      ),
      "@potential-guide/pilot-protocol/validation": join(
        root,
        "packages/pilot-protocol/src/validation.ts",
      ),
      "@potential-guide/pilot-protocol/resources": join(
        root,
        "packages/pilot-protocol/src/resources.ts",
      ),
      "@potential-guide/pilot-protocol": join(root, "packages/pilot-protocol/src/index.ts"),
      "@potential-guide/check-host": join(root, "packages/check-host/src/index.ts"),
    },
    plugins: [
      {
        name: "artifact-resource-boundaries",
        setup(build) {
          build.onResolve({ filter: /runtime\/evidence\.mjs$/ }, () => ({
            path: join(root, ".staging", job.package, "runtime", "evidence.mjs"),
          }));
          build.onLoad({ filter: /(?:contract|transport|ssh-target)\.mjs$/ }, async ({ path }) => {
            let contents = await readFile(path, "utf8");
            contents = contents.replace(
              'new URL("..", import.meta.url)',
              'new URL("./resources/", import.meta.url)',
            );
            contents = contents.replace(
              '"../dist/package/runtime/health-check.mjs"',
              '"./resources/health-check.mjs"',
            );
            if (path.endsWith("ssh-target.mjs"))
              contents = contents.replace('"./dist/package/"', '"./resources/"');
            return { contents, loader: "js" };
          });
        },
      },
    ],
  });
  await emit(join(directory, "worker.cjs"), result.outputFiles[0].contents);
  for (const [source, target] of job.resources ?? [])
    await emit(join(directory, "resources", target), await readFile(join(packageRoot, source)));
  if (job.resourceTree)
    await resources(
      join(packageRoot, job.resourceTree),
      join(directory, "resources", ...(job.resourceTree === "runtime" ? [] : ["sanity-fixture"])),
    );
  if (job.package === "objective-pguide-setup")
    await emit(
      join(directory, "resources", "runtime", "setup-check.mjs"),
      await readFile(join(packageRoot, "runtime", "setup-check.mjs")),
    );
}
console.log(`Worker artifacts: ${jobs.length} checked/generated.`);
