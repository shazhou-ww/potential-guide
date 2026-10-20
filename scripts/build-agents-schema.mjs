import { mkdir, readFile, writeFile } from "node:fs/promises";

const source = new URL("../schemas/agents/v1.json", import.meta.url);
const directory = new URL("../packages/pguide-cli-core/dist/schemas/agents/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("v1.json", directory), await readFile(source));
