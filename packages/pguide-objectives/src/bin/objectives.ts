#!/usr/bin/env node
import { launchCommand } from "@potential-guide/cli-core";

launchCommand(
  "objectives",
  async () => (await import("../index.js")).runObjectives,
  new URL("../../package.json", import.meta.url),
);
