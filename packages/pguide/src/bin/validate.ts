#!/usr/bin/env node
import { launchCommand } from "../command-help.js";

launchCommand("validate", async () => (await import("../commands/pilot.js")).runValidate);
