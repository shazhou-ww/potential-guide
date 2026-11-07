---
title: Check results
description: Shared result and problem contracts for Task Engine checks.
---

# Check results

Checks report only problems. Both variants require result-level `documentation`:
`{"pass":true,"documentation":{"en":"ipfs://<CID>/resources/references/en/check.md"}}`.
Failing results additionally contain a nonempty `problems` list; each problem
contains target/code/actual plus its own `documentation` mapping, such as
`{"en":"ipfs://<CID>/resources/references/en/problems/too-old.md"}`.
The failing list must be nonempty. No additional properties are accepted.
`target` is a nonempty string of at most 4096 characters; `actual` is a string
or null. A problem code must belong to the Check Build YAML's `problemCodes`.
That single declaration generates the literal tuple used by TypeScript,
the result Schema and runtime assembly, as well as documentation coverage.
Undeclared runtime codes throw; they are not ordinary findings.

Every mapping requires exactly all declared languages, not a selected locale.
References bind the verified executing Bundle's immutable root. Callers can
detach any node and read its URI directly; the generated index is optional.
Documentation is fetched only by the caller, never by result assembly.
Reader errors remain reader errors and never change `pass` or the problems.

The existing `pass`, `problems`, `target`, `code`, `actual` facts are retained,
but documentation is a required breaking addition to the strict contract.
Successful items are not returned. Inspectors return `CheckObservation` without
documentation; the shared adapter attaches it.
Execution failures and cancellation are not problems; see
[callbacks](check-callback.md).
