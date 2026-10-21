import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { ignored, type Snapshot, secretPath } from "./shared.js";

type Entries = { files: string[]; directories: string[] };
type MatchFiles = (
  path: string,
  extensions: readonly string[] | undefined,
  excludes: readonly string[] | undefined,
  includes: readonly string[] | undefined,
  useCaseSensitiveFileNames: boolean,
  currentDirectory: string,
  depth: number | undefined,
  entries: (path: string) => Entries,
  realpath: (path: string) => string,
) => string[];

export async function typeScriptHost(
  snapshot: Snapshot,
): Promise<ts.ParseConfigHost & ts.ModuleResolutionHost> {
  const view = await snapshot.compilerView();
  if (view === undefined) return ts.sys;
  const root = view.root;
  const caseSensitive = ts.sys.useCaseSensitiveFileNames;
  const key = (path: string) => (caseSensitive ? path : path.toLowerCase());
  const paths = new Map(
    Object.entries(view.entries).map(([path, entry]) => [
      key(resolve(view.root, path)),
      { path: resolve(view.root, path), entry },
    ]),
  );
  const directories = new Map<string, Entries>();
  for (const { path, entry } of paths.values()) {
    if (entry.kind === "directory") directories.set(key(path), { files: [], directories: [] });
  }
  for (const { path, entry } of paths.values()) {
    if (path === view.root) continue;
    const parent = directories.get(key(dirname(path)));
    if (entry.kind === "directory") parent?.directories.push(basename(path));
    else if (entry.kind === "file") parent?.files.push(basename(path));
  }
  function inside(path: string): string | undefined {
    const absolute = resolve(root, path);
    const rel = relative(root, absolute);
    if (
      isAbsolute(rel) ||
      rel === ".." ||
      rel.startsWith(`..${sep}`) ||
      secretPath.test(rel.split(sep).join("/")) ||
      rel.split(sep).some((part) => ignored.has(part))
    )
      return undefined;
    let current = root;
    for (const part of rel.split(sep).filter(Boolean)) {
      current = resolve(current, part);
      if (paths.get(key(current))?.entry.kind === "link") return undefined;
    }
    return absolute;
  }
  function bounded(path: string): string {
    const absolute = inside(path);
    if (absolute === undefined)
      throw new Error("TypeScript read is outside the input view boundary.");
    return absolute;
  }
  const entries = (path: string): Entries => {
    const absolute = bounded(path);
    const result = directories.get(key(absolute));
    return result === undefined
      ? { files: [], directories: [] }
      : {
          files: [...result.files].sort(),
          directories: [...result.directories].sort(),
        };
  };
  const canonical = (path: string) => {
    const absolute = bounded(path);
    return paths.get(key(absolute))?.path ?? absolute;
  };
  // Use TypeScript's own matcher, exactly as its Node system does, with only
  // directory enumeration and canonicalization replaced by captured facts.
  const matchFiles = (ts as unknown as { matchFiles: MatchFiles }).matchFiles;
  return {
    useCaseSensitiveFileNames: caseSensitive,
    getCurrentDirectory: () => view.root,
    fileExists(path) {
      const absolute = bounded(path);
      return paths.get(key(absolute))?.entry.kind === "file";
    },
    directoryExists(path) {
      const absolute = bounded(path);
      return paths.get(key(absolute))?.entry.kind === "directory";
    },
    getDirectories: (path) => entries(path).directories,
    realpath: canonical,
    readFile(path) {
      const absolute = bounded(path);
      const entry = paths.get(key(absolute))?.entry;
      if (entry === undefined || entry.kind !== "file") return undefined;
      if (entry.size === undefined || entry.size > 1024 * 1024 || entry.text === undefined)
        throw new Error("TypeScript requires a readable captured file <= 1 MiB.");
      if (entry.encodedBytes === undefined) return entry.text.replace(/^\uFEFF/, "");
      const bytes = Buffer.from(entry.encodedBytes, "base64");
      if (bytes.length !== entry.size) throw new Error("Captured TypeScript byte size mismatch.");
      if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString("utf16le", 2);
      if (bytes[0] !== 0xfe || bytes[1] !== 0xff)
        throw new Error("Invalid captured TypeScript byte encoding.");
      const littleEndian = Buffer.from(bytes.subarray(2, bytes.length - (bytes.length % 2)));
      littleEndian.swap16();
      return littleEndian.toString("utf16le");
    },
    readDirectory(path, extensions, excludes, includes, depth) {
      return matchFiles(
        path,
        extensions,
        excludes,
        includes,
        caseSensitive,
        view.root,
        depth,
        entries,
        canonical,
      );
    },
  };
}
