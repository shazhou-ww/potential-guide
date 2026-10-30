# @potential-guide/task-engine-http

`createTaskHandler({service, resolveCaller, prefix?})` returns an asynchronous
WHATWG `Request -> Response` handler. It does not create an Engine or listener.
The host owns authentication, Node/framework bridging, TLS and process lifecycle.

POST `/tasks` uses `Idempotency-Key` for requestId; body retains type and business
input. GET `/tasks/:id`, POST `/tasks/:id/cancel`, GET `/requests/:id`,
GET `/event-history` and GET `/events` call the same authorized core service.
GET `/task-types` returns current `{type,version,inputSchema,revision}` entries,
using submit authorization. Optional POST `If-Match: "<revision>"` rejects stale
contracts with 412/`contract_revision_mismatch` before persistence. It is not part
of the JSON body or raw requestId identity. No artifact URL is resolved by discovery.
History/SSE select exactly one taskId, executionId or seriesId. SSE uses
Last-Event-ID, bounded pull/backpressure and durable cursor recovery.
Disconnecting never cancels a Task. Cursor expiration is 410/history_expired.

GET `/tasks` is the separately authorized Task directory. It accepts `type`,
`createdFrom`, `createdBefore`, `updatedFrom`, `updatedBefore`, `sort`, `cursor`
and `limit`; duplicate/unknown parameters are errors. Time bounds require explicit
timezones, lower-inclusive/upper-exclusive. Send the original filters on every
page. Results freeze membership, ordering and payload-free summaries until
`expiresAt`; removal/restart/expiry returns 410/query_expired, not a partial
success. Event cursors cannot be used here. Capacity errors are 429 and complete
page byte-limit errors are 413. See the guide for budgets and cursor rules.

See [the engine guide](../../docs/task-engine.md).
