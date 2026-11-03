import { readArtifactFiles } from "@potential-guide/check-artifacts/files";
import { type IpfsImportClient, publishContent } from "@potential-guide/ipfs-content";
import { inspectTaskArtifact } from "./artifact.js";

export async function importTaskBundle(directory: string, ipfsClient: IpfsImportClient) {
  // Validate and publish the same immutable byte snapshot, never re-read after admission.
  const files = await readArtifactFiles(directory);
  const checked = await inspectTaskArtifact(files);
  const cid = await publishContent(files, ipfsClient);
  if (cid !== checked.cid) throw new Error("Published CID differs from the checked Task Bundle.");
  return { cid };
}
export { createIpfsClient } from "@potential-guide/ipfs-content";
