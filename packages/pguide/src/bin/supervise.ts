#!/usr/bin/env node
import { commandMain } from "@potential-guide/cli-core";
import { runSupervise } from "../commands/supervisor.js";

void commandMain(
  {
    protocol: "pguide-command-v1",
    command: "supervise",
    description: "Supervise an Objective portfolio",
    version: "0.3.0-rc.0",
  },
  runSupervise,
);
