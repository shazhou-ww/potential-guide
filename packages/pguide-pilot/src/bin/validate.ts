#!/usr/bin/env node
import { launchCommand } from "@potential-guide/cli-core";

launchCommand(
  "validate",
  async () => (await import("../commands/pilot.js")).runValidate,
  new URL("../../package.json", import.meta.url),
);
