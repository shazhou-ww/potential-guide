---
title: Unexpected HTTP status
description: The HTTP response did not satisfy status and redirect expectations.
---

`target` is the requested URL; `actual` is the decimal response status.
Check expectedStatus and followRedirects, endpoint health and authentication.
A redirect fails when following redirects is disabled, even when listed as an
expected status. See [network checks](../check.md).
