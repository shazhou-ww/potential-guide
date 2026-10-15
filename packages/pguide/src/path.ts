import { realpath } from "node:fs/promises";
import { normalize, resolve, win32 } from "node:path";

export async function sameDirectory(
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform,
  canonicalize: (path: string) => Promise<string> = realpath,
): Promise<boolean> {
  const canonical = async (path: string) => {
    const absolute = platform === "win32" ? win32.resolve(path) : resolve(path);
    let value: string;
    try {
      value = await canonicalize(absolute);
    } catch {
      value = absolute;
    }
    const normalized = platform === "win32" ? win32.normalize(value) : normalize(value);
    return platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
  };
  return (await canonical(left)) === (await canonical(right));
}
