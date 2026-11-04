import { encodeContentCar } from "@potential-guide/ipfs-content/codec";
import {
  type IpfsImportClient,
  pinContent,
  writeContentCar,
} from "@potential-guide/ipfs-content/publish";
import { inspectTaskArtifact, readTaskArtifact } from "./artifact.js";

export async function importTaskBundle(directory: string, ipfsClient: IpfsImportClient) {
  // Validate and publish the same immutable byte snapshot, never re-read after admission.
  const snapshot = await readTaskArtifact(directory);
  const checked = await inspectTaskArtifact(snapshot.files);
  const archive = snapshot.archive ?? (await encodeContentCar(snapshot.files)).bytes;
  const cid = await writeContentCar(archive, checked.cid, ipfsClient);
  if (cid !== checked.cid) throw new Error("Published CID differs from the checked Task Bundle.");
  await pinContent(cid, ipfsClient);
  return { cid };
}
export { createIpfsClient } from "@potential-guide/ipfs-content/publish";
