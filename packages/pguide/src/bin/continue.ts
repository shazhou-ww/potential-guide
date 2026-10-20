#!/usr/bin/env node
import { launchCommand } from "../command-help.js";

launchCommand("continue", async () => (await import("../commands/regulator.js")).runContinue);
