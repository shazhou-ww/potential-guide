#!/usr/bin/env node
import { commandMain } from "@potential-guide/cli-core";
import { regulatorCommandVersion, runContinue } from "../commands/regulator.js";

void commandMain(
  {
    protocol: "pguide-command-v1",
    command: "continue",
    description: "Continue a persisted Regulation",
    version: regulatorCommandVersion,
  },
  runContinue,
);
