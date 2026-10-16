#!/usr/bin/env node
import { launchPilotCommand, pilotCommandVersion, runProbe } from "../commands/pilot.js";

launchPilotCommand(
  {
    protocol: "pguide-command-v1",
    command: "probe",
    description: "Observe an Objective Pilot",
    version: pilotCommandVersion,
  },
  runProbe,
);
