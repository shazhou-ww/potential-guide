import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createCheckTask } from "@potential-guide/check-sdk";
import { runTask } from "@silvermoon-work/task-sdk";
import { parse } from "yaml";
import { languages, problemCodes } from "../dist/definitions/monorepo-policy.js";

const check = createCheckTask(problemCodes, languages, async (input, context) => {
  context.signal.throwIfAborted();
  const root = resolve(input.repositoryRoot);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error("Repository root must be an ordinary directory.");
  const canonicalRoot = await realpath(root);

  const failures: string[] = [];
  async function readPolicyFile(name: string): Promise<string | null> {
    const file = join(root, name);
    let pathInfo: Awaited<ReturnType<typeof lstat>>;
    try {
      pathInfo = await lstat(file);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        failures.push(`${name} is missing`);
        return null;
      }
      throw error;
    }
    if (!pathInfo.isFile() || pathInfo.isSymbolicLink() || pathInfo.size > 1_048_576) {
      failures.push(`${name} is not a bounded regular file`);
      return null;
    }
    const handle = await open(file, "r");
    try {
      const info = await handle.stat();
      const target = await realpath(file);
      if (!info.isFile() || info.size > 1_048_576 || target !== join(canonicalRoot, name)) {
        failures.push(`${name} is not a bounded regular file`);
        return null;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      while (total <= 1_048_576) {
        const buffer = Buffer.alloc(Math.min(65_536, 1_048_577 - total));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > 1_048_576) {
          failures.push(`${name} is not a bounded regular file`);
          return null;
        }
        chunks.push(buffer.subarray(0, bytesRead));
      }
      return Buffer.concat(chunks, total).toString("utf8");
    } finally {
      await handle.close();
    }
  }

  const [packageText, workspaceText] = await Promise.all([
    readPolicyFile("package.json"),
    readPolicyFile("pnpm-workspace.yaml"),
  ]);
  if (packageText !== null) {
    let manifest: unknown;
    try {
      manifest = JSON.parse(packageText);
    } catch {
      failures.push("package.json is invalid JSON");
    }
    if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
      const packageJson = manifest as {
        packageManager?: unknown;
        engines?: { node?: unknown };
      };
      if (packageJson.packageManager !== "pnpm@11.22.0")
        failures.push("packageManager must pin pnpm@11.22.0");
      if (packageJson.engines?.node !== ">=22.13.0")
        failures.push("engines.node must require >=22.13.0");
    }
  }
  if (workspaceText !== null) {
    let workspace: unknown;
    try {
      workspace = parse(workspaceText);
    } catch {
      failures.push("pnpm-workspace.yaml is invalid YAML");
    }
    if (workspace && typeof workspace === "object" && !Array.isArray(workspace)) {
      const packages = (workspace as { packages?: unknown }).packages;
      if (
        !Array.isArray(packages) ||
        !packages.includes("apps/*") ||
        !packages.includes("packages/*")
      )
        failures.push("workspace packages must include apps/* and packages/*");
    }
  }
  return failures.length
    ? [
        {
          target: "monorepo",
          code: "standardization-incomplete",
          actual: failures.join("; ").slice(0, 2048),
        },
      ]
    : [];
});

runTask(check);
