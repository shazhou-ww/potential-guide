#!/usr/bin/env node
import { launchPilotCommand, pilotCommandVersion, runValidate } from "../commands/pilot.js";

launchPilotCommand(
  {
    protocol: "pguide-command-v1",
    command: "validate",
    description: "Validate an Objective Pilot",
    version: pilotCommandVersion,
  },
  runValidate,
);
