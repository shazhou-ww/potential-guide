#!/usr/bin/env node
import { launchCommand } from "@potential-guide/cli-core";

launchCommand(
  "probe",
  async () => (await import("../commands/pilot.js")).runProbe,
  new URL("../../package.json", import.meta.url),
);
