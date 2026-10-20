#!/usr/bin/env node
import { launchCommand } from "../command-help.js";

launchCommand("supervise", async () => (await import("../commands/supervisor.js")).runSupervise);
