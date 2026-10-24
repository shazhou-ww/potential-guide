#!/usr/bin/env node
import { main } from "./dist/package/runtime/setup-check.mjs";

await main(process.argv[2], { selfCheck: true });
