#!/usr/bin/env node
void import("../../runtime/setup-check.mjs").then(({ main }) =>
  main("configuration", { pilot: true, selfCheck: true }),
);
