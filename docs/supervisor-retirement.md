# Supervisor retirement

The workspace no longer ships `@potential-guide/objective-portfolio-supervisor`
or `@potential-guide/pguide-supervise`. Remove them from explicit installations;
remove their old shims from PATH. `pguide supervise` is no longer a built-in
command or an installation recommendation. General third-party command discovery
is unchanged; uninstall an independently installed old extension to stop discovering it.
There is no compatibility package, renamed Planner, Coordinator CLI or MCP server.
Previously published npm versions are not withdrawn or deprecated by this change.

Use `@potential-guide/regulation-coordinator` directly for immutable one-time and
recurring requests. External callers decide policy and resources; expiry never
grants authority or quota, and exhaustion never automatically restarts a Run.
The existing Coordinator five-command API remains available. `regulate` and
`continue` remain the single-regulation CLI entrypoints; Pilot commands are unchanged.

Coordinator now owns its `AgentResource` and `RunHandle` public types and its
internal resource matching, legacy input validation and canonical JSON helper.
`levelRank` comes from Objective Pilot. Persisted keys retain locale-aware
`localeCompare` ordering, exact source versions and existing event facts.
JSON and legacy validation errors remain `TypeError`s with the existing messages;
the retired package's `ObjectivePortfolioError` constructor is not a new public API.

Remove `supervise.agentTimeoutMs` and portfolio/Planner configuration from active
settings. `regulate.agentTimeoutMs`, `regulate.quota`, Agent profiles and Pilot
probe settings retain their meanings. Portfolio files are not implicitly converted
to Requests: Planner policy and immutable timed requests have different semantics.
See the [Coordinator API](../packages/regulation-coordinator/README.md).
