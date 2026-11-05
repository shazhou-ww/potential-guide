---
title: Network reachability
description: Check explicit DNS names and HTTP status expectations with bounded resource lifetimes.
---

# Network reachability

Input contains `dns` names and `http` entries with `url`, `expectedStatus`,
`followRedirects`; at least one check is required. Optional `checkTimeoutMs`
defaults to 5000 (100–300000). The host requires DNS/network access and Node
subprocess support. HTTP(S) URLs cannot contain credentials.
DNS runs in a bounded subprocess; HTTP response bodies are cancelled.

Problems: [DNS unavailable](problems/dns-unavailable.md),
[unexpected HTTP status](problems/http-status.md),
[HTTP unavailable](problems/http-unavailable.md).
Results contain only failures; `target` is the DNS name or URL, `actual` is
the DNS error/address, status string or fetch diagnostic.
Timeouts, invalid inputs, unexpected subprocess faults and cleanup failures
remain execution faults. Cancellation propagates and physical resources are
released. This is a point-in-time probe, not a network repair or guarantee.
