#!/usr/bin/env node
import {
  launchRegulatorCommand,
  regulatorCommandVersion,
  runRegulate,
} from "../commands/regulator.js";
launchRegulatorCommand(
  {
    protocol: "pguide-command-v1",
    command: "regulate",
    description: "Run a bounded Objective regulation",
    version: regulatorCommandVersion,
  },
  runRegulate,
);
