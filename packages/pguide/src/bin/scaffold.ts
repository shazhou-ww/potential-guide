#!/usr/bin/env node
import { launchPilotCommand, pilotCommandVersion, runScaffold } from "../commands/pilot.js";

launchPilotCommand(
  {
    protocol: "pguide-command-v1",
    command: "scaffold",
    description: "Create an Objective Pilot skeleton",
    version: pilotCommandVersion,
  },
  runScaffold,
);
