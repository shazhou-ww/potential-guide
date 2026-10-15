# Implementation

## Steps

### I-S01: Separate stage semantics from check scheduling

Refine the guide API and probe flow so same-stage checks are independent,
scheduling owns execution concurrency, and complete stage results determine
advancement. Preserve prerequisite barriers and explicit operation errors.

### I-S02: Verify stage and scheduling behavior

Add deterministic tests for overlapping checks, bounded and serial scheduling,
multiple same-stage failures, stage barriers, and prerequisite behavior. Exercise
regulator and portfolio integration where affected.

### I-S03: Document the stage contract

Update directly related package documentation to distinguish attained levels,
independent checks, and actual scheduling. Document any public API changes and
shared temporary-directory implications.

## Acceptance criteria

### I-AC01: Independent checks honor scheduling limits

Deterministic runner tests prove same-stage checks overlap when permitted,
respect configured concurrency, and all remain eligible after a peer fails,
including when execution is serialized.

### I-AC02: Stage observations and barriers remain correct

Tests prove failures are reported deterministically for the current stage,
later stages wait for all current-stage checks to pass, prerequisites retain
their unlock behavior, and invalid results or runner errors reject explicitly.

### I-AC03: Integration and documentation agree

The affected package tests, repository type checks, and lint pass, and package
documentation describes the implemented semantics and scheduling API.
