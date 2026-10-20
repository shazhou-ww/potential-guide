#!/usr/bin/env node
import { launchCommand } from "@potential-guide/cli-core";

launchCommand(
  "scaffold",
  async () => (await import("../commands/pilot.js")).runScaffold,
  new URL("../../package.json", import.meta.url),
);
