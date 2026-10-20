import { posix } from "node:path";
export const stages = ["identity", "system", "toolchains", "order", "sustainability"];
export const minimumVersions = Object.freeze({
  git: "2.30",
  node: "22.13",
  npm: "10",
  tsc: "5",
  python3: "3.10",
  "c++": "10",
  cmake: "3.20",
  ninja: "1.10",
  rustup: "1.25",
  rustc: "1.75",
  cargo: "1.75",
});
export const defaultPolicy = Object.freeze({
  minFreeBytes: 1_073_741_824,
  minFreeInodes: 1024,
  retentionSeconds: 86400,
  historyMinSamples: 3,
  historyMinSpanMs: 1000,
  historyMaxAgeMs: 300000,
  maxCacheGrowthBytesPerSecond: 1_048_576,
  maxLogGrowthBytesPerSecond: 65_536,
  maxPackageIndexAgeSeconds: 604800,
});
export const problemIds = Object.freeze({
  identity: ["identity-mismatch", "environment-mismatch", "directory-unusable", "sudo-unavailable"],
  system: [
    "directory-unusable",
    "capacity-low",
    "inodes-low",
    "unsupported-package-manager",
    "package-database-unhealthy",
    "dns-unavailable",
    "http-unavailable",
  ],
  toolchains: ["directory-unusable", "tool-missing", "tool-version", "toolchain-failed"],
  order: [
    "layout-invalid",
    "directory-unusable",
    "task-registry-invalid",
    "task-orphaned",
    "task-overdue",
    "task-residue",
    "task-process-leftover",
  ],
  sustainability: [
    "directory-unusable",
    "history-insufficient",
    "history-invalid",
    "cache-growth",
    "log-growth",
    "unsupported-package-manager",
    "package-index-stale",
    "updates-pending",
    "reboot-required",
  ],
});
export const directories = [
  "home",
  "workspace",
  "scratchDirectory",
  "cacheDirectory",
  "logDirectory",
  "tasksDirectory",
];
export const sampleKeys = [
  "hostname",
  "user",
  "home",
  "measuredAt",
  "freeBytes",
  "freeInodes",
  "cacheBytes",
  "logBytes",
];
export const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const text = (v) => typeof v === "string" && v.length > 0 && !/[\0\r\n]/.test(v);
export const numeric = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
export const absolute = (v) =>
  text(v) && v.startsWith("/") && v !== "/" && posix.normalize(v) === v && !v.endsWith("/");
export const httpUrl =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Network URLs must reject embedded control characters.
  /^https?:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(?::(?:[1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5]))?(?:\/[^\s@\u0000-\u001f]*)?$/;
export const keys = (v, allowed) => record(v) && Object.keys(v).every((k) => allowed.includes(k));
export const own = (v, required) => required.every((k) => Object.hasOwn(v, k));
export const issue = (id, parameters = {}) => ({ id, parameters });
export const envelope = (problems = [], diagnostics = []) => ({
  status: 200,
  payload: { ok: problems.length === 0, problems },
  message: diagnostics.join("; "),
});
export class Fault extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
export function validSample(v) {
  return (
    keys(v, sampleKeys) &&
    own(v, sampleKeys) &&
    ["hostname", "user"].every((k) => text(v[k])) &&
    absolute(v.home) &&
    sampleKeys.slice(3).every((k) => numeric(v[k]))
  );
}
export function validateSubject(value) {
  const required = ["environment", "user", ...directories, "stacks"];
  if (
    !keys(value, [...required, "target", "minimumVersions", "policy", "network", "history"]) ||
    !own(value, required) ||
    !["container", "native-linux", "wsl"].includes(value.environment) ||
    !text(value.user) ||
    !/^[a-z_][a-z0-9_-]*[$]?$/i.test(value.user) ||
    !directories.every((k) => absolute(value[k])) ||
    !Array.isArray(value.stacks) ||
    new Set(value.stacks).size !== value.stacks.length ||
    !value.stacks.every((v) => ["typescript", "python", "cpp", "rust"].includes(v))
  )
    throw new Fault("invalid-subject: expected the documented Linux machine-health subject.", 400);
  if (
    value.target !== undefined &&
    !(
      (keys(value.target, ["type"]) && value.target.type === "local") ||
      (keys(value.target, ["type", "container"]) &&
        value.target.type === "docker" &&
        text(value.target.container) &&
        /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value.target.container))
    )
  )
    throw new Fault("invalid-subject: invalid target.", 400);
  if (
    value.minimumVersions !== undefined &&
    (!keys(value.minimumVersions, Object.keys(minimumVersions)) ||
      !Object.values(value.minimumVersions).every((v) => text(v) && /^\d+(?:\.\d+)*$/.test(v)))
  )
    throw new Fault("invalid-subject: invalid minimumVersions.", 400);
  if (
    value.policy !== undefined &&
    (!keys(value.policy, Object.keys(defaultPolicy)) ||
      !Object.entries(value.policy).every(
        ([k, v]) =>
          numeric(v) &&
          (k !== "historyMinSamples" || (Number.isSafeInteger(v) && v >= 3)) &&
          (k !== "historyMinSpanMs" || v >= 1000),
      ))
  )
    throw new Fault("invalid-subject: invalid policy.", 400);
  if (
    value.network !== undefined &&
    (!keys(value.network, ["dns", "urls"]) ||
      !own(value.network, ["dns", "urls"]) ||
      !Array.isArray(value.network.dns) ||
      !Array.isArray(value.network.urls) ||
      !value.network.dns.every(
        (v) => text(v) && v.length <= 253 && /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(v),
      ) ||
      !value.network.urls.every((v) => text(v) && httpUrl.test(v)))
  )
    throw new Fault(
      "invalid-subject: network requires DNS names and credential-free HTTP URLs.",
      400,
    );
  if (
    value.history !== undefined &&
    (!Array.isArray(value.history) ||
      value.history.length > 10000 ||
      !value.history.every(validSample))
  )
    throw new Fault("invalid-subject: invalid history sample schema.", 400);
  return {
    ...value,
    target: value.target ?? { type: "local" },
    policy: { ...defaultPolicy, ...value.policy },
    minimumVersions: { ...minimumVersions, ...value.minimumVersions },
  };
}
