# Deliver the Objective Guidance Package Suite

## Problem

The Silvermoon Objective Guidance idea defines reusable core, regulation, and portfolio contracts, but those capabilities do not yet exist as independently consumable packages. Keeping them only inside Silvermoon would couple a general model to one domain and leave the optional regulation layers without an implementation home.

## Outcome

A pnpm TypeScript monorepo delivers `@potential-guide/objective-guide`, `@potential-guide/objective-regulator`, and `@potential-guide/objective-portfolio-supervisor` as a cohesive package suite that implements the selected upstream contracts.

## Boundaries

- The contract source and package ownership are fixed in [Package boundaries](./package-boundaries.md); public APIs do not expose potential-field physics metaphors.
- Dependencies flow from Objective Guide to Objective Regulator to Objective Portfolio Supervisor without cycles or domain-specific Silvermoon runtime dependencies.
- This idea covers implementation, verification, and consumer-ready artifacts, but not Silvermoon integration or publication to a package registry.

## Acceptance criteria

- Each named package exposes its assigned public contracts and observable behavior from the pinned upstream idea.
- The three packages build and can be imported independently with only the declared one-way package dependencies.
- Automated tests and package documentation demonstrate core observation and reference behavior, guarded single-objective regulation, and policy-driven multi-objective supervision.
