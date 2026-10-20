#!/usr/bin/env node
import { launchCommand } from "../command-help.js";

launchCommand("regulate", async () => (await import("../commands/regulator.js")).runRegulate);
