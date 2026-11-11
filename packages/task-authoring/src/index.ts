import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encodeTaskBundleCar, readTaskBundleCar } from "@silvermoon-work/task-builder/car";
import { memoryTree, type ReadonlyFileTree, readBytes } from "@silvermoon-work/task-builder/tree";
import { runTaskBuilderCli } from "@silvermoon-work/task-builder-cli";
import { directoryTree } from "@silvermoon-work/task-builder-cli/node";
import { taskBundleLimits } from "@silvermoon-work/task-protocol";

/** Invoke the upstream CLI contract, retaining its input/output safety checks. */
export async function buildTask(file: string) {
  let output = "";
  const status = await runTaskBuilderCli(["build", resolve(file)], {
    stdout: {
      write: (text) => {
        output += text;
      },
    },
  });
  const result = JSON.parse(output);
  if (status !== 0 || !result.ok) throw new Error(result.error?.message ?? "Task build failed.");
  return {
    cid: result.data.cid as string,
    directory: result.data.module.directory as string,
    car: result.data.car.path as string,
  };
}

async function collect(tree: ReadonlyFileTree) {
  const files = new Map<string, Buffer>();
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await tree.list(directory)) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.kind === "directory") await walk(path);
      else files.set(path, Buffer.from(await readBytes(tree, path, taskBundleLimits.fileBytes)));
    }
  };
  await walk("");
  return files;
}

export async function readTaskArtifact(path: string, expectedCid?: string) {
  const absolute = resolve(path);
  const info = await lstat(absolute);
  const options = expectedCid === undefined ? {} : { expectedCid };
  if (info.isSymbolicLink()) throw new Error("Task artifacts cannot be symbolic links.");
  if (info.isDirectory()) {
    const tree = await directoryTree(absolute);
    const encoded = await encodeTaskBundleCar(tree);
    try {
      const checked = await readTaskBundleCar(encoded.stream, options);
      try {
        return { files: await collect(checked.tree), cid: checked.cid };
      } finally {
        await checked.close();
      }
    } finally {
      await encoded.close();
    }
  }
  if (!info.isFile() || info.nlink !== 1 || info.size > taskBundleLimits.archiveBytes)
    throw new Error("Task CAR must be a bounded ordinary file, without links.");
  const archive = await readFile(absolute);
  const checked = await readTaskBundleCar(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(archive);
        controller.close();
      },
    }),
    options,
  );
  try {
    return { files: await collect(checked.tree), cid: checked.cid, archive };
  } finally {
    await checked.close();
  }
}

export function toTaskSchema(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value));
}

export async function inspectTaskArtifact(files: ReadonlyMap<string, Uint8Array>) {
  const encoded = await encodeTaskBundleCar(memoryTree(files));
  try {
    return { cid: encoded.cid };
  } finally {
    await encoded.close();
  }
}
