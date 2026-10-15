#!/usr/bin/env node
import { guideCommandVersion, launchGuideCommand, runProbe } from "../cli.js";
launchGuideCommand(
  {
    protocol: "pguide-command-v1",
    command: "probe",
    description: "Probe an Objective Guide",
    version: guideCommandVersion,
  },
  runProbe,
);
