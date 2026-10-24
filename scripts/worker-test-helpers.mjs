import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  CheckKernel,
  connectHost,
  ensurePrivateDirectory,
  publishPrivateFile,
  readArtifact,
  removePrivateFile,
  serve,
} from "../packages/check-host/dist/index.js";

export async function createWorkerHost(directory) {
  await mkdir(directory, { recursive: true });
  const discovery = join(directory, "discovery");
  await ensurePrivateDirectory(discovery);
  const kernel = await CheckKernel.create(join(discovery, "snapshots"));
  const token = randomUUID();
  const host = await serve(kernel, token);
  const descriptor = JSON.stringify({
    endpoint: host.endpoint,
    token,
    pid: process.pid,
    instance: randomUUID(),
  });
  const previous = process.env.PGUIDE_CHECK_HOST_DIRECTORY;
  try {
    if (!(await publishPrivateFile(discovery, "host.json", descriptor, null)))
      throw new Error("Fixture discovery directory already contains a Host.");
    process.env.PGUIDE_CHECK_HOST_DIRECTORY = discovery;
    const client = await connectHost(discovery);
    return {
      directory: discovery,
      diagnostics: () => kernel.diagnostics(),
      async execute(artifactDirectory, subject) {
        const artifact = await readArtifact(artifactDirectory);
        const state = await client.execute(
          { directory: artifact.directory, revision: artifact.revision, subject },
          AbortSignal.timeout(30_000),
        );
        return state.state === "Completed"
          ? state.result
          : {
              status: 502,
              payload: null,
              message: state.state === "Failed" ? state.error : state.state,
            };
      },
      async close() {
        try {
          await host.close();
          await removePrivateFile(discovery, "host.json", descriptor);
        } finally {
          if (previous === undefined) delete process.env.PGUIDE_CHECK_HOST_DIRECTORY;
          else process.env.PGUIDE_CHECK_HOST_DIRECTORY = previous;
        }
      },
    };
  } catch (error) {
    if (previous === undefined) delete process.env.PGUIDE_CHECK_HOST_DIRECTORY;
    else process.env.PGUIDE_CHECK_HOST_DIRECTORY = previous;
    await host.close();
    throw error;
  }
}
