#!/usr/bin/env node
import { main } from "./runtime/setup-check.mjs";

await main(process.argv[2], { selfCheck: true });
