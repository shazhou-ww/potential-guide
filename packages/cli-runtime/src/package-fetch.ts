import { chmod, copyFile, lstat, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import Arborist from "@npmcli/arborist";
import runScript from "@npmcli/run-script";
import npa from "npm-package-arg";
import packlist from "npm-packlist";
import pacote from "pacote";

export interface PackageFetchRequest {
  readonly spec: string;
  readonly archive: string;
  readonly cwd: string;
  readonly cache: string;
  readonly allowScripts: boolean;
  readonly registry?: string;
}

let started = false;
// Stream promises can briefly have no referenced handles; keep IPC alive until the reply.
process.on("message", async (request: PackageFetchRequest) => {
  if (started) return;
  started = true;
  try {
    const options = {
      cache: request.cache,
      where: request.cwd,
      ignoreScripts: !request.allowScripts,
      Arborist,
      ...(request.registry === undefined ? {} : { registry: request.registry }),
    };
    const parsed = npa(request.spec, request.cwd);
    let packingSpec = request.spec;
    if (parsed.type === "directory" && parsed.fetchSpec !== null) {
      const directory = parsed.fetchSpec;
      const manifest: unknown = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (
        request.allowScripts &&
        manifest !== null &&
        typeof manifest === "object" &&
        "scripts" in manifest &&
        manifest.scripts !== null &&
        typeof manifest.scripts === "object" &&
        "prepare" in manifest.scripts &&
        typeof manifest.scripts.prepare === "string"
      )
        await runScript({
          event: "prepare",
          path: directory,
          stdio: "pipe",
          env: {
            npm_package_resolved: directory,
            npm_package_json: join(directory, "package.json"),
          },
        });
      const tree = await new Arborist({ path: directory }).loadActual();
      const files = await packlist(tree, { path: directory });
      packingSpec = join(dirname(request.archive), "npm-directory");
      await mkdir(packingSpec);
      // npm's tar packer can deadlock on cross-directory hardlinks; copy its own packlist first.
      for (const name of files) {
        const location = relative(directory, join(directory, name));
        if (isAbsolute(location) || location === ".." || location.startsWith(`..${sep}`))
          throw new Error("npm packlist escaped its package root.");
        const source = join(directory, name);
        const before = await lstat(source);
        if (!before.isFile() || before.isSymbolicLink())
          throw new Error("npm directory package contains a non-regular packed entry.");
        const target = join(packingSpec, name);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
        await chmod(target, before.mode & 0o777);
      }
    }
    const metadata = parsed.registry ? await pacote.manifest(request.spec, options) : undefined;
    const resolved = metadata?._resolved;
    if (metadata && typeof resolved !== "string")
      throw new Error("npm registry did not return an exact tarball resolution.");
    const result = await pacote.tarball.file(
      typeof resolved === "string" ? resolved : packingSpec,
      request.archive,
      {
        ...options,
        ...(parsed.type === "directory" ? { ignoreScripts: true } : {}),
        ...(metadata?._integrity ? { integrity: String(metadata._integrity) } : {}),
      },
    );
    if (parsed.type === "directory") await rm(packingSpec, { recursive: true, force: true });
    process.send?.(
      {
        ok: true,
        result: {
          from: parsed.type === "directory" ? parsed.raw : (result.from ?? request.spec),
          resolved: parsed.type === "directory" ? parsed.fetchSpec : result.resolved,
          integrity: result.integrity ? String(result.integrity) : "",
          ...(metadata === undefined
            ? {}
            : { selectedName: metadata.name, selectedVersion: metadata.version }),
        },
      },
      () => {
        if (!request.allowScripts) process.disconnect();
      },
    );
  } catch (cause) {
    process.send?.(
      { ok: false, error: cause instanceof Error ? cause.message : String(cause) },
      () => {
        if (!request.allowScripts) process.disconnect();
      },
    );
  }
});
process.send?.({ type: "ready" });
