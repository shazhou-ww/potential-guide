#!/usr/bin/env node
import { launchCommand } from "../command-help.js";

launchCommand("probe", async () => (await import("../commands/pilot.js")).runProbe);
