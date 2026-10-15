import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const destination = resolve(process.argv[2] ?? join(root, ".cache", "npm-bootstrap"));
const packages = ["objective-guide", "objective-regulator", "objective-portfolio-supervisor"];
const packageManagerCli = process.env.npm_execpath;
if (packageManagerCli === undefined) {
  throw new Error("Run this script through pnpm bootstrap:pack.");
}
const packageManagerIsExecutable = packageManagerCli.toLowerCase().endsWith(".exe");

await mkdir(dirname(destination), { recursive: true });
await mkdir(destination);

const temporaryRoot = await mkdtemp(join(tmpdir(), "potential-guide-npm-bootstrap-"));
try {
  for (const directory of packages) {
    const sourceManifest = JSON.parse(
      await readFile(join(root, "packages", directory, "package.json"), "utf8"),
    );
    const packageRoot = join(temporaryRoot, directory);
    await mkdir(packageRoot);
    const manifest = {
      name: sourceManifest.name,
      version: "0.0.0",
      description: `${sourceManifest.description} Bootstrap placeholder only.`,
      license: sourceManifest.license,
      repository: sourceManifest.repository,
      publishConfig: {
        access: "public",
      },
    };
    await Promise.all([
      writeFile(join(packageRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`),
      writeFile(
        join(packageRoot, "README.md"),
        `# ${sourceManifest.name}\n\nThis 0.0.0 release is a bootstrap placeholder. Use version 0.1.0 or newer.\n`,
      ),
    ]);

    const command = packageManagerIsExecutable ? packageManagerCli : process.execPath;
    const args = packageManagerIsExecutable
      ? ["pack", "--pack-destination", destination, "--json"]
      : [packageManagerCli, "pack", "--pack-destination", destination, "--json"];
    const packed = JSON.parse(
      execFileSync(command, args, {
        cwd: packageRoot,
        encoding: "utf8",
        windowsHide: true,
      }),
    );
    const result = Array.isArray(packed) ? packed[0] : packed;
    if (result?.name !== sourceManifest.name || result.version !== "0.0.0") {
      throw new Error(`Unexpected bootstrap artifact for ${sourceManifest.name}.`);
    }
    console.log(`${sourceManifest.name}: ${resolve(destination, result.filename)}`);
  }
} catch (error) {
  await rm(destination, { recursive: true, force: true });
  throw error;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
