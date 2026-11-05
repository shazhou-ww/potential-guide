---
title: Nonempty text
description: Check that the input text contains a non-whitespace character.
---

Input is `{text:string}`. This check uses no physical resources or network.
Whitespace-only input returns [text-empty](problems/text-empty.md), otherwise
`{pass:true}`. Execution and cancellation follow the shared Check SDK contract.
