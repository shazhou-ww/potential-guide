#!/usr/bin/env node
import { userConfigPath } from "@potential-guide/cli-core";
import { ConfigurationError, parseArguments, resolveConfig } from "./config.js";

const metadata = {
  protocol: "pguide-command-v1",
  command: "task-engine",
  version: "0.1.0-rc.2",
  description: "Start a foreground loopback Task Engine, optionally with its HTTP Web UI.",
};
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === "--pguide-command-metadata") {
    console.log(JSON.stringify(metadata));
    return;
  }
  const parsed = parseArguments(argv.map((arg) => (arg === "-h" ? "--help" : arg)));
  if (parsed.options.help) {
    const help = {
      schemaVersion: 1,
      command: "task-engine",
      usage: "pguide task-engine [--config server.yaml|server.json] [options]",
      options: [
        "--host <127.0.0.1|localhost|::1>",
        "--port <0..65535>",
        "--database <path>",
        '--ipfs-gateway-urls \'["https://primary.example","https://backup.example"]\'',
        "--ipfs-gateway-url <root HTTP(S) Gateway URL; legacy single-source alias>",
        "--ipfs-gateway-timeout-ms <total budget per missing block; default 30000>",
        "--ipfs-gateway-attempt-timeout-ms <per-source budget; default 5000>",
        "--scope <local-scope>",
        "--ui",
        "--no-ui",
        '--ui-options \'{"host":"127.0.0.1","port":4310,"favoritesFile":"favorites.json"}\'',
        "--no-global-config",
        "--cwd <directory>",
        "--help",
        "--format json",
      ],
      precedence:
        "Explicit CLI > explicit YAML/JSON file > pguide USER config.jsonc > defaults. Project service settings are never read.",
      globalConfig: userConfigPath(),
      paths:
        "Effective CWD is --cwd or process CWD for both entrypoints and --config. Each file's paths are relative to that file; CLI paths are relative to effective CWD.",
      validation:
        "Invalid or unreadable global configuration/settings registry emits a warning and the entire global layer is ignored. Explicit file and CLI layers must validate even when overridden. Complete settings (including uiOptions) replace, never deep merge. No executable config or environment service overrides.",
      isolation:
        "--no-global-config skips the user main file, including top-level discovery and user commandDirectories. PATH and project discovery remain available.",
      defaults: {
        host: "127.0.0.1",
        port: 3000,
        database: "tasks.sqlite",
        scope: "local",
        ipfsGatewayTimeoutMs: 30000,
        ipfsGatewayAttemptTimeoutMs: 5000,
        ui: false,
        uiOptions: { host: "127.0.0.1", port: 4310, favoritesFile: "task-favorites.json" },
      },
      security:
        "No token; fixed loopback only (localhost becomes 127.0.0.1; ::1 supported). Caller local-cli is limited to the configured scope. Host/Origin/fetch-site, GET/POST and JSON writes are checked. Do not expose through a proxy. Other local users/processes are not isolated.",
      lifecycle:
        "Foreground only. Stops only this invocation's Engine/UI on SIGINT/SIGTERM. Never manages Kubo. No UI unless --ui. Gateway-only: 1..16 ordered trusted root HTTP(S) URLs required (no credentials/query/fragment/path prefix). No discovery, redirects or public fallback; each block is CID-verified. Each source is tried once within a shared per-block total budget; cancellation stops failover. Lists replace as a whole; the legacy single URL replaces the list across layers, but both forms in one layer fail. Request hints are not authorized by the service. No RPC/transport selection; publisher import/pin is optional and separate.",
    };
    console.log(
      parsed.options.format === "json"
        ? JSON.stringify(help)
        : `${help.usage}\n${help.options.join("\n")}\n\n${help.precedence}\nUser config: ${help.globalConfig}\n${help.paths}\n${help.validation}\n${help.isolation}\nDefaults: ${JSON.stringify(help.defaults)}\n${help.security}\n${help.lifecycle}`,
    );
    return;
  }
  if (parsed.options.version) {
    console.log(metadata.version);
    return;
  }
  const config = await resolveConfig(parsed);
  const { startService } = await import("./service.js");
  const service = await startService(config);
  console.log(
    JSON.stringify({ event: "ready", url: service.url, uiUrl: service.uiUrl, pid: process.pid }),
  );
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void service.close().then(
      () => {
        process.removeListener("SIGINT", shutdown);
        process.removeListener("SIGTERM", shutdown);
        console.log(JSON.stringify({ event: "closed" }));
      },
      () => {
        console.error("Shutdown failed; physical cleanup unconfirmed.");
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
void main().catch((error: unknown) => {
  // Errors from libraries can contain URL credentials or config excerpts.
  console.error(
    error instanceof ConfigurationError
      ? error.message
      : "Invalid configuration or service startup failed; cleanup unconfirmed.",
  );
  process.exit(1);
});
