import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareCheck, verifyCheckResources } from "@potential-guide/check-sdk/authoring";
import { runTaskBuilderCli } from "@silvermoon-work/task-builder-cli";

const prepared = await prepareCheck(
  fileURLToPath(new URL("text.check.build.yaml", import.meta.url)),
);
let output = "";
process.exitCode = await runTaskBuilderCli(["build", prepared.buildFile], {
  stdout: {
    write: (text) => {
      output += text;
    },
  },
});
if (process.exitCode === 0) {
  const { data } = JSON.parse(output);
  const files = new Map(
    await Promise.all(
      data.module.files.map(async (path) => [
        path,
        await readFile(join(data.module.directory, path)),
      ]),
    ),
  );
  verifyCheckResources(prepared, files);
}
process.stdout.write(output);
