#!/usr/bin/env node
void import("../../check.mjs").then(({ run }) => run("structure", undefined, "package"));
