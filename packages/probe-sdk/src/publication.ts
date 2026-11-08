import {
  bundleCid,
  validateBundleReference,
} from "@potential-guide/task-protocol/bundle-reference";

export interface PublicationResolution {
  cid: string;
  revision: number;
}
/**
 * Pinboard public metadata adapter. The caller supplies its authorized API transport;
 * a publication page, upload attachment, or CAR-file CID is never treated as a Bundle.
 */
export function createPinboardResolver(options: {
  origin: string;
  getPublication(id: string, signal: AbortSignal): Promise<unknown>;
}) {
  const origin = new URL(options.origin);
  if (origin.protocol !== "https:" || origin.origin !== options.origin)
    throw new Error("Pinboard requires an exact HTTPS origin.");
  return async (url: string, signal: AbortSignal): Promise<PublicationResolution> => {
    const locator = new URL(url);
    const match = /^\/publications\/([a-zA-Z0-9-]{1,128})$/.exec(locator.pathname);
    if (
      locator.origin !== origin.origin ||
      locator.username ||
      locator.password ||
      locator.search ||
      locator.hash ||
      !match
    )
      throw new Error("Unauthorized Pinboard publication locator.");
    signal.throwIfAborted();
    const metadata = await options.getPublication(match[1]!, signal);
    signal.throwIfAborted();
    if (JSON.stringify(metadata).length > 65_536)
      throw new Error("Publication metadata budget exceeded.");
    if (
      !metadata ||
      typeof metadata !== "object" ||
      !("id" in metadata) ||
      metadata.id !== match[1] ||
      !("currentRevision" in metadata) ||
      !Number.isSafeInteger(metadata.currentRevision) ||
      Number(metadata.currentRevision) < 1 ||
      !("current" in metadata) ||
      !metadata.current ||
      typeof metadata.current !== "object" ||
      !("revision" in metadata.current) ||
      metadata.current.revision !== metadata.currentRevision ||
      !("cid" in metadata.current) ||
      typeof metadata.current.cid !== "string"
    )
      throw new Error("Invalid Pinboard public publication metadata.");
    return {
      revision: Number(metadata.currentRevision),
      cid: bundleCid(validateBundleReference(metadata.current.cid)),
    };
  };
}
