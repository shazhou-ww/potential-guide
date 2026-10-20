#!/usr/bin/env node
import { launchCommand } from "../command-help.js";

launchCommand("objectives", async () => (await import("../objectives.js")).runObjectives);
