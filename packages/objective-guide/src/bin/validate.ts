#!/usr/bin/env node
import { guideCommandVersion, launchGuideCommand, runValidate } from "../cli.js";
launchGuideCommand(
  {
    protocol: "pguide-command-v1",
    command: "validate",
    description: "Validate an Objective Guide",
    version: guideCommandVersion,
  },
  runValidate,
);
