---
title: Check callbacks
description: Callback, cancellation, logging and resource ownership boundaries for checks.
---

# Check callbacks

`createCheckTask(problemCodes, languages, inspect)` adapts an async
`inspect(input, context)` returning a readonly problem list into a Task callback.
The full Task Context is passed unchanged: use `context.log` for logs.
The adapter checks `context.signal` before and after the callback and never
catches exceptions. Execution faults remain Engine failures; cancellation
remains cancellation, never `pass:false`.
Generated YAML definitions provide both tuples. After inspection, the adapter
uses the trusted `context.bundle.cid` to attach all-language documentation
references to the result and each problem. Missing/invalid identity or undeclared
codes reject explicitly. No document is read, and no CID is baked into the worker.

The business implementation owns timeouts, subprocesses, sockets and files.
Release them in `finally` before returning or propagating an error. The SDK
does not schedule, kill processes or mask cleanup failures.
Authors explicitly call `runTask(createCheckTask(...))` in their entrypoint.
The root import is runtime-only; import Schemas from `check-sdk/contracts`
and filesystem validation from `check-sdk/authoring`.
See [result contracts](check-result.md).
