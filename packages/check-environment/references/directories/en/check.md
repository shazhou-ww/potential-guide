---
title: Directory access
description: Check absolute directory paths and explicit exists, read or write requirements.
---

# Directory access

Input `directories` lists absolute `path` and nonempty `requirements` from
`exists`, `read`, `write`. Symlinks are not accepted as directories.
Read uses host access checks. Write creates an exclusive probe file, reads it
back and deletes it in `finally`; it does not modify existing files.
The Engine host must have the requested permissions.

Results contain only failures: [not-directory](problems/not-directory.md) or
[directory-unusable](problems/directory-unusable.md). `target` is the absolute
path; `actual` is the filesystem error code or null. Invalid input, unexpected
filesystem errors, readback mismatch and cleanup errors remain execution
faults. Cancellation propagates after probe cleanup. No repair is performed.
