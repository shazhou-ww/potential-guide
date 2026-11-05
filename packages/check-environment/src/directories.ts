import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { problemCodes } from "../dist/definitions/directories.js";
import { type CheckContext, type CheckItem, errorCode, problems, result } from "./result.js";

export interface DirectoryInput {
  directories: { path: string; requirements: ("exists" | "read" | "write")[] }[];
}

export async function probeDirectoryWrite(path: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const probe = join(path, `.pguide-check-${randomUUID()}`);
  let created = false;
  try {
    await writeFile(probe, "directory-check\n", { flag: "wx", mode: 0o600 });
    created = true;
    signal?.throwIfAborted();
    if ((await readFile(probe, "utf8")) !== "directory-check\n")
      throw new Error("Directory write probe readback mismatch.");
  } finally {
    if (created) await rm(probe);
  }
}

export async function inspectDirectories(input: DirectoryInput, context: CheckContext = {}) {
  if (!input.directories.length || input.directories.length > 100)
    throw new Error("Specify between 1 and 100 directories.");
  for (const directory of input.directories) {
    if (
      !isAbsolute(directory.path) ||
      directory.path.includes("\0") ||
      !directory.requirements.length ||
      directory.requirements.some((value) => !["exists", "read", "write"].includes(value))
    )
      throw new Error("Directories require absolute paths and explicit access requirements.");
  }
  const checks: CheckItem<(typeof problemCodes)[number]>[] = [];
  for (const directory of input.directories) {
    context.signal?.throwIfAborted();
    let code: (typeof checks)[number]["code"] = "pass";
    let actual: string | null = null;
    try {
      const info = await lstat(directory.path);
      if (!info.isDirectory() || info.isSymbolicLink()) code = "not-directory";
      else {
        if (directory.requirements.includes("read"))
          await access(directory.path, constants.R_OK | constants.X_OK);
        if (directory.requirements.includes("write"))
          await probeDirectoryWrite(directory.path, context.signal);
      }
    } catch (error) {
      context.signal?.throwIfAborted();
      actual = errorCode(error) ?? null;
      if (
        actual === null ||
        !["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EROFS", "ENOSPC", "EDQUOT"].includes(actual)
      )
        throw error;
      code = "directory-unusable";
    }
    checks.push({ target: directory.path, ok: code === "pass", code, actual });
  }
  return problems(checks);
}

export async function checkDirectories(input: DirectoryInput, context: CheckContext = {}) {
  return result(problemCodes, await inspectDirectories(input, context));
}

export default checkDirectories;
