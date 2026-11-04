import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import {
  extractGlobals,
  loadConfig,
  parseConfig,
  parseJsonc,
  userConfigPath,
} from "@potential-guide/cli-core";
import { parseDocument } from "yaml";

export interface ServiceConfig {
  host: string;
  port: number;
  database: string;
  ipfsGatewayUrl: string;
  scope: string;
  ui: boolean;
  uiOptions: { host: string; port: number; favoritesFile: string };
}
export class ConfigurationError extends Error {}
const fields = new Set(["host", "port", "database", "ipfsGatewayUrl", "scope", "ui", "uiOptions"]);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function invalid(source: string, field: string): never {
  // Never include values, parser excerpts or URLs in diagnostics.
  throw new ConfigurationError(`Invalid ${field} in ${source}.`);
}
function retired(source: string): never {
  throw new ConfigurationError(
    `RPC/transport service configuration is retired in ${source}. Remove ipfsRpcUrl/ipfsTransport (including task-engine. setting IDs) and --ipfs-rpc-url/--ipfs-transport; migrate to ipfsGatewayUrl or --ipfs-gateway-url with an explicit read-only Gateway URL.`,
  );
}
function host(value: unknown, source: string): string {
  if (!["127.0.0.1", "localhost", "::1"].includes(value as string)) invalid(source, "host");
  return value === "localhost" ? "127.0.0.1" : (value as string);
}
function port(value: unknown, source: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 65535)
    invalid(source, "port");
  return value as number;
}
function path(value: unknown, base: string, source: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) invalid(source, "path");
  return resolve(base, value);
}

/** Validate every provided value before replacing complete settings across layers. */
export function validateLayer(
  value: unknown,
  base: string,
  source: string,
): Partial<ServiceConfig> {
  if (!object(value)) invalid(source, "configuration");
  const result: Partial<ServiceConfig> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "ipfsRpcUrl" || key === "ipfsTransport") retired(source);
    if (!fields.has(key)) invalid(source, "unknown service field");
    switch (key) {
      case "host":
        result.host = host(entry, source);
        break;
      case "port":
        result.port = port(entry, source);
        break;
      case "database":
        result.database = path(entry, base, source);
        break;
      case "ipfsGatewayUrl": {
        let url: URL;
        try {
          if (typeof entry !== "string") invalid(source, key);
          url = new URL(entry);
        } catch {
          invalid(source, key);
        }
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.href.includes("?") ||
          url.href.includes("#")
        )
          invalid(source, key);
        result[key] = url.href;
        break;
      }
      case "scope":
        if (typeof entry !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry)) invalid(source, key);
        result.scope = entry;
        break;
      case "ui":
        if (typeof entry !== "boolean") invalid(source, key);
        result.ui = entry;
        break;
      case "uiOptions":
        if (
          !object(entry) ||
          Object.keys(entry).length !== 3 ||
          !["host", "port", "favoritesFile"].every((name) => Object.hasOwn(entry, name))
        )
          invalid(source, key);
        result.uiOptions = {
          host: host(entry.host, source),
          port: port(entry.port, source),
          favoritesFile: path(entry.favoritesFile, base, source),
        };
        break;
    }
  }
  return result;
}

export function parseArguments(argv: readonly string[]) {
  const { options, rest } = extractGlobals(argv, { serviceConfig: true });
  const cli: Record<string, unknown> = {};
  const seen = new Set<string>();
  let configFile: string | undefined;
  let global = true;
  const names: Record<string, string> = {
    "--host": "host",
    "--port": "port",
    "--database": "database",
    "--ipfs-gateway-url": "ipfsGatewayUrl",
    "--scope": "scope",
    "--ui-options": "uiOptions",
  };
  for (let index = 0; index < rest.length; index++) {
    const raw = rest[index]!;
    const equals = raw.indexOf("=");
    const flag = equals < 0 ? raw : raw.slice(0, equals);
    if (flag === "--ipfs-rpc-url" || flag === "--ipfs-transport") retired("CLI");
    const key = flag === "--no-ui" ? "--ui" : flag;
    if (seen.has(key)) throw new ConfigurationError("Repeated service option.");
    seen.add(key);
    if (["--ui", "--no-ui", "--no-global-config"].includes(flag)) {
      if (equals >= 0) throw new ConfigurationError("Boolean switches do not take values.");
      if (flag === "--no-global-config") global = false;
      else cli.ui = flag === "--ui";
      continue;
    }
    if (flag !== "--config" && !Object.hasOwn(names, flag))
      throw new ConfigurationError("Unknown service option.");
    const value = equals < 0 ? rest[++index] : raw.slice(equals + 1);
    if (!value || value.startsWith("--"))
      throw new ConfigurationError("Service option requires a value.");
    if (flag === "--config") configFile = resolve(options.cwd, value);
    else {
      const field = names[flag]!;
      if (field === "port") {
        if (!/^\d+$/.test(value)) invalid("CLI", field);
        cli[field] = Number(value);
      } else if (field === "uiOptions") {
        try {
          cli[field] = JSON.parse(value);
        } catch {
          invalid("CLI", field);
        }
      } else cli[field] = value;
    }
  }
  return { options, cli, configFile, global };
}

export async function resolveConfig(
  parsed: ReturnType<typeof parseArguments>,
): Promise<ServiceConfig> {
  const cwd = parsed.options.cwd;
  const defaults: Omit<ServiceConfig, "ipfsGatewayUrl"> = {
    host: "127.0.0.1",
    port: 3000,
    database: resolve(cwd, "tasks.sqlite"),
    scope: "local",
    ui: false,
    uiOptions: {
      host: "127.0.0.1",
      port: 4310,
      favoritesFile: resolve(cwd, "task-favorites.json"),
    },
  };
  let user: Partial<ServiceConfig> = {};
  if (parsed.global) {
    try {
      const userPath = userConfigPath();
      const text = await readFile(userPath, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "{}";
        throw error;
      });
      // Validate explicit service fields before catalog validation: old registrations
      // may omit retired IDs or conflict with the bundled settings description.
      user = validateLayer(
        Object.fromEntries(
          Object.entries(parseConfig(text))
            .filter(([id]) => id.startsWith("task-engine."))
            .map(([id, value]) => [id.slice(12), value]),
        ),
        dirname(userPath),
        "pguide user config",
      );
      await loadConfig(cwd, [], { project: false });
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      throw new ConfigurationError(
        "Cannot read or validate pguide user configuration/settings registry.",
      );
    }
  }
  let file: Partial<ServiceConfig> = {};
  if (parsed.configFile) {
    const extension = extname(parsed.configFile).toLowerCase();
    if (![".yaml", ".yml", ".json"].includes(extension))
      throw new ConfigurationError(
        "Service --config requires YAML/JSON data. Executable .mjs configs are retired; migrate to declarative fields.",
      );
    let value: unknown;
    try {
      const text = await readFile(parsed.configFile, "utf8");
      if (extension === ".json") {
        value = JSON.parse(text);
        parseJsonc(text);
      } else {
        const document = parseDocument(text, { uniqueKeys: true });
        if (document.errors.length || document.warnings.length) invalid("service file", "YAML");
        value = document.toJS({ maxAliasCount: 0 });
      }
    } catch {
      throw new ConfigurationError("Cannot read or parse service YAML/JSON file.");
    }
    file = validateLayer(value, dirname(parsed.configFile), "service file");
  }
  const cli = validateLayer(parsed.cli, cwd, "CLI");
  const final = { ...defaults, ...user, ...file, ...cli };
  requireGateway(final);
  return validateLayer(final, cwd, "effective configuration") as ServiceConfig;
}

export function requireGateway(config: Partial<ServiceConfig>): void {
  if (!config.ipfsGatewayUrl)
    throw new ConfigurationError(
      "Service requires an explicit ipfsGatewayUrl; provide --ipfs-gateway-url or task-engine.ipfsGatewayUrl. No default Gateway is selected.",
    );
}
