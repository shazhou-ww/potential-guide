---
title: Tool versions
description: Check explicit commands and minimum numeric versions without installing or repairing tools.
---

# Tool versions

Input `tools` lists `command`, `args` and `minimumVersion`; optional
`checkTimeoutMs` defaults to 5000 (100–300000). Commands run without a shell.
The host must allow subprocess creation. Versions are dot-separated decimal
numbers, compared numerically; the first recognizable output version is used.
The result is `{pass:true}` or only failing `target`, `code`, `actual` entries.
`target` is the command and `actual` is the parsed version or null.

Problems: [missing](problems/tool-missing.md),
[unusable](problems/tool-unusable.md),
[unparseable](problems/version-unparseable.md),
[too old](problems/tool-version.md).
Timeout, output overflow, unexpected launch errors and cleanup failures are
execution faults, not problems. Cancellation propagates after physical process
cleanup. No installation or repair is performed.
