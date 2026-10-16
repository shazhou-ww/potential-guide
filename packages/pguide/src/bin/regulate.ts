#!/usr/bin/env node
import { commandMain } from "@potential-guide/cli-core";
import { regulatorCommandVersion, runRegulate } from "../commands/regulator.js";

void commandMain(
  {
    protocol: "pguide-command-v1",
    command: "regulate",
    description: "Run Pilot regulation with per-Agent execution limits",
    version: regulatorCommandVersion,
  },
  runRegulate,
);
