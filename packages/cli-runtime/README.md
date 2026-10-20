# @potential-guide/cli-runtime

Tool-side source acquisition and runtime assembly (`withPilot`). No executable
commands; declaration selection/binding is the separate protocol-only
`objective-declarations` tool service, and mutation belongs to `pguide-objectives`.
This source service never depends on command packages, regulation or the
portfolio supervisor. Callers inject any business-error propagation predicate.
Business packages consume injected capabilities, never this tool implementation.

See [package layering](../../docs/package-layering.md) and the
[command reference](../pguide/README.md).
