import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CheckKernel,
  connectHost,
  readArtifact,
  serve,
} from "../packages/check-host/dist/index.js";

export async function createWorkerHost(directory) {
  await mkdir(directory, { recursive: true });
  const kernel = await CheckKernel.create(join(directory, "snapshots"));
  const token = randomUUID();
  const host = await serve(kernel, token);
  const previous = process.env.PGUIDE_CHECK_HOST_DIRECTORY;
  try {
    await writeFile(
      join(directory, "host.json"),
      JSON.stringify({ endpoint: host.endpoint, token, pid: process.pid, instance: randomUUID() }),
      { flag: "wx" },
    );
    process.env.PGUIDE_CHECK_HOST_DIRECTORY = directory;
    const client = await connectHost(directory);
    return {
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
