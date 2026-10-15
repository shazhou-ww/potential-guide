# Implementation

[Verification evidence](./verification.md) records the reproducible checks for this implementation.

## Steps

### I-S01: Establish the package workspace

Create a Node.js 22.12+ workspace pinned to pnpm 11.22.0, TypeScript project references, Biome checks, and publishable manifests for the three scoped packages with the required one-way dependency graph.

### I-S02: Implement the Objective Guide core

Implement canonical URI loading and caching, strict manifests, typed instance creation, bounded prerequisite projection, localized levels and references, ordered checks, and fresh observations in `@potential-guide/objective-guide`.

### I-S03: Implement regulation and portfolio layers

Implement the guarded single-objective loop and policy-driven portfolio supervisor in their dependent packages, then document their APIs and verify the built package artifacts.

## Acceptance criteria

### I-AC01: Core contracts conform

The Objective Guide package exposes the assigned contract surface and passes tests for loading, validation, prerequisites, localization, ordered observations, and reference access.

### I-AC02: Regulation semantics are guarded

Regulator and Portfolio Supervisor tests prove target validation, action and re-probe behavior, termination limits, policy planning, priority preservation, deferral, and explicit failure propagation.

### I-AC03: Monorepo verification succeeds

`pnpm install --frozen-lockfile` and `pnpm check` pass; packed artifacts omit source, tests, and build metadata; runtime exports match each package manifest; and package documentation maps the public APIs to their owners.
