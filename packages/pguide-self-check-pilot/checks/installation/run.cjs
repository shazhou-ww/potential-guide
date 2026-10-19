#!/usr/bin/env node
void import("../../runtime/setup-check.mjs").then(({ main }) =>
  main("installation", { pilot: true, selfCheck: true }),
);
