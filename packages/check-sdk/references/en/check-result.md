---
title: Check results
description: Shared result and problem contracts for Task Engine checks.
---

# Check results

Checks report only problems: `{"pass":true}` for none, otherwise
`{"pass":false,"problems":[{"target":"node","code":"too-old","actual":"20.0.0"}]}`.
The failing list must be nonempty. No additional properties are accepted.
`target` is a nonempty string of at most 4096 characters; `actual` is a string
or null. A problem code must belong to the Check Build YAML's `problemCodes`.
That single declaration generates the literal tuple used by TypeScript,
the result Schema and runtime assembly, as well as documentation coverage.
Undeclared runtime codes throw; they are not ordinary findings.

Result compatibility deliberately keeps the existing `pass`, `problems`,
`target`, `code`, `actual` shape. Successful items are not returned.
Execution failures and cancellation are not problems; see
[callbacks](check-callback.md).
