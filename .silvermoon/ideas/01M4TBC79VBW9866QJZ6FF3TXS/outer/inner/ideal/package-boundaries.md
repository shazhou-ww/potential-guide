# Package boundaries

## Contract source

This idea implements the contracts from Silvermoon idea `01M4R4SBD141TF1W7674ZFNPJV` at commit `045461743a9d80d11485e88f08c35ab7e6c83c46`:

- [Objective Guide type system](https://github.com/shazhou-ww/silvermoon/blob/045461743a9d80d11485e88f08c35ab7e6c83c46/.silvermoon/ideas/01M4R4SBD141TF1W7674ZFNPJV/outer/inner/ideal/objective-guidance.md)
- [Objective Regulator contract](https://github.com/shazhou-ww/silvermoon/blob/045461743a9d80d11485e88f08c35ab7e6c83c46/.silvermoon/ideas/01M4R4SBD141TF1W7674ZFNPJV/outer/inner/ideal/objective-regulator.md)
- [Objective Portfolio Supervisor contract](https://github.com/shazhou-ww/silvermoon/blob/045461743a9d80d11485e88f08c35ab7e6c83c46/.silvermoon/ideas/01M4R4SBD141TF1W7674ZFNPJV/outer/inner/ideal/objective-portfolio-supervisor.md)
- [Value-field reasoning](https://github.com/shazhou-ww/silvermoon/blob/045461743a9d80d11485e88f08c35ab7e6c83c46/.silvermoon/ideas/01M4R4SBD141TF1W7674ZFNPJV/outer/inner/ideal/value-field-reasoning.md)

The Silvermoon-specific objective definitions remain a domain example rather than package behavior.

## Package ownership

### `@potential-guide/objective-guide`

Owns the language-neutral Objective Loader, Guide and subject/language-bound Guide Instance contracts; manifest loading; typed instance-creation failures; prerequisite projection; ordered levels; checks; localization; observations; and reference-page access.

### `@potential-guide/objective-regulator`

Depends on `@potential-guide/objective-guide`. Owns the guarded probe, single-action, re-probe loop for one Guide Instance, including target validation, execution limits, explicit terminal statuses, and rejection of unmodeled failures.

### `@potential-guide/objective-portfolio-supervisor`

Depends on both preceding packages. Owns registration of instance-bound regulators, non-atomic portfolio observations, injected policy planning, defensive and opportunistic directives, deferred objectives, and prioritized execution with independent results.

## Shared invariants

- Level IDs are stable and ordered only within their owning Guide; packages never compare or aggregate levels across Objectives.
- Probes may perform I/O and do not claim atomic snapshots. Every real-world action is followed by a new observation before progress is asserted.
- Reality-changing work is performed only by injected Agent executors. Guide APIs observe and explain; portfolio policies plan.
- Expected validation and language failures use typed results. Unexpected loading, I/O, and execution failures remain explicit errors rather than success-shaped statuses.
