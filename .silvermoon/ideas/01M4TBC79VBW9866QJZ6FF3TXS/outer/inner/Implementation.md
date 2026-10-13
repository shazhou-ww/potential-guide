# Implementation

## Steps

### I-S01: Establish the package workspace

Create the pinned pnpm and TypeScript workspace, shared quality commands, and manifests for the three scoped packages with the required one-way dependency graph.

### I-S02: Implement the Objective Guide core

Implement the loader, manifests, Guide and Instance APIs, prerequisite and language handling, observations, checks, and localized reference access in `@potential-guide/objective-guide`.

### I-S03: Implement regulation and portfolio layers

Implement the guarded single-objective loop and policy-driven portfolio supervisor in their dependent packages, then document and test all package boundaries.

## Acceptance criteria

### I-AC01: Core contracts conform

The Objective Guide package exposes the assigned contract surface and passes tests for loading, validation, prerequisites, localization, ordered observations, and reference access.

### I-AC02: Regulation semantics are guarded

Regulator and Portfolio Supervisor tests prove target validation, action and re-probe behavior, termination limits, policy planning, priority preservation, deferral, and explicit failure propagation.

### I-AC03: Monorepo verification succeeds

A frozen install plus repository build, type-check, lint, and test commands pass, package artifacts expose only declared entry points, and documentation maps each public API to its owning package.
