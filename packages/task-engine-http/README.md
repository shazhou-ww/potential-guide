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

See [the engine guide](../../docs/task-engine.md).
