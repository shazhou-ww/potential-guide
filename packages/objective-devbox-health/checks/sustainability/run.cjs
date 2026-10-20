#!/usr/bin/env node
void import("../../health-check.mjs").then(({ main }) => main("sustainability"));
