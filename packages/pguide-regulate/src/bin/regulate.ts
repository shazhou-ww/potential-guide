#!/usr/bin/env node
import { launchCommand } from "@potential-guide/cli-core";

launchCommand(
  "regulate",
  async () => (await import("../commands/regulator.js")).runRegulate,
  new URL("../../package.json", import.meta.url),
);
