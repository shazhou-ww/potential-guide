#!/usr/bin/env node
import { launchCommand } from "@potential-guide/cli-core";

launchCommand(
  "supervise",
  async () => (await import("../commands/supervisor.js")).runSupervise,
  new URL("../../package.json", import.meta.url),
);
