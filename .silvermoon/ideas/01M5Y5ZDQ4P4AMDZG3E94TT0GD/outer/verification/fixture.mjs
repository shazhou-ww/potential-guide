import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

export const intervalMs = 3000;
export const limits = { timeoutMs: 20000, maxAgentRuns: 3, maxStallRuns: 2 };
const digest = `sha256-pguide-package-v1:${"e".repeat(64)}`;
export const objective = {
  objectiveId: "@fixture/recurrence",
  version: digest,
  source: {
    kind: "npm-package",
    packageName: "@fixture/recurrence",
    packageDigest: digest,
    spec: "@fixture/recurrence@1.0.0",
    version: "1.0.0",
    resolved: "https://registry.example.test/recurrence-1.0.0.tgz",
    integrity: "sha512-fixture",
  },
  manifest: {
    $schema: "https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json",
    subjectSchema: { type: "object", additionalProperties: false },
    levels: [{ id: "ready", checks: [] }],
    languages: ["zh-CN"],
    defaultLanguage: "zh-CN",
  },
  locales: {
    "zh-CN": {
      "system/404": {
        id: "system/404",
        title: "缺少指引",
        description: "",
        content: "",
        references: [],
      },
    },
  },
};

export function command(ref, recurrence) {
  return {
    type: "request",
    requestRef: ref,
    objective,
    subject: {},
    desiredLevel: "ready",
    priority: 1,
    origin: { kind: "external" },
    eligibleAt: new Date().toISOString(),
    ...(recurrence ? { recurrence: { intervalMs } } : {}),
  };
}

export function workerPath(directory, runId) {
  return join(directory, `${createHash("sha256").update(runId).digest("hex")}.json`);
}

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function writeJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
