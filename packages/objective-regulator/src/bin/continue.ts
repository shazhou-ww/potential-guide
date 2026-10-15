#!/usr/bin/env node
import { launchRegulatorCommand, regulatorCommandVersion, runContinue } from "../cli.js";
launchRegulatorCommand(
  {
    protocol: "pguide-command-v1",
    command: "continue",
    description: "Continue a persisted Regulation",
    version: regulatorCommandVersion,
  },
  runContinue,
);
