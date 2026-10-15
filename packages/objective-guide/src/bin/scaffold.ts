#!/usr/bin/env node
import { guideCommandVersion, launchGuideCommand, runScaffold } from "../cli.js";
launchGuideCommand(
  {
    protocol: "pguide-command-v1",
    command: "scaffold",
    description: "Create an Objective Guide skeleton",
    version: guideCommandVersion,
  },
  runScaffold,
);
