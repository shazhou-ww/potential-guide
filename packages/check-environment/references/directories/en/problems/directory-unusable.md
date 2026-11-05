---
title: Directory unavailable
description: The directory is missing or requested access failed with a recognized filesystem error.
---

`target` is the absolute directory path; `actual` is ENOENT, ENOTDIR, EACCES,
EPERM, EROFS, ENOSPC or EDQUOT. Check path, permissions, filesystem capacity and
mount state. Resolve the cause separately; no repair is attempted.
Unexpected errors and cleanup failures are faults, not this problem.
See [directory checks](../check.md).
