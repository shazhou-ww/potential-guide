#!/usr/bin/env node
void import("../../runtime/setup-check.mjs").then(({ main }) =>
  main("sanity", { pilot: true, selfCheck: true }),
);
