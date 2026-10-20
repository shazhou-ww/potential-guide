#!/usr/bin/env node
import { launchCommand } from "../command-help.js";

launchCommand("scaffold", async () => (await import("../commands/pilot.js")).runScaffold);
