# @potential-guide/objective-host

Composable Objective v1 observation, without Agent execution or Regulation scheduling.

```ts
import { serveUnifiedHost, ObjectiveTaskClient } from "@potential-guide/objective-host";

const host = await serveUnifiedHost({
  directory: absolutePrivateCache,
  allowedOrigins: ["https://example.com"],
  languages: ["zh-CN", "en"],
  token: privateToken,
});
const client = new ObjectiveTaskClient({ endpoint: host.endpoint, token: privateToken });
const task = await client.probe({ objective: { url, digest }, subject: { root } });
const observation = await task.result();
client.close(); // Does not cancel Tasks.
await host.close();
```

`createUnifiedServices` creates no listener. Mount its Routers in an existing
authenticated server, or use `createObjectiveRouter(service, prefix)`.
The in-process Objective service calls the Checker service directly.
`ObjectiveTaskClient`/`ProbeTask` match the new
`@potential-guide/checker-host/v3` `CheckTaskClient`/`CheckTask` API.
Root `checker-host` still exports the legacy v2 SDK for existing consumers.

Tasks support `snapshot`, `events`, `result`, `cancel`; clients expose
`watchTasks`, `taskSnapshot`, `cancelTask`, `resolveArtifact`, `artifact`,
`reference`, `close`. SSE uses explicit task IDs (or explicit `scope=all`);
reconnection obtains authoritative bounded snapshots, not a replay log.
Service restart invalidates Tasks; the SDK never silently reruns them.

Default strong freshness requires an Execution started after admission.
Weak freshness requires whole-observation completion after admission, not
freshness of every leaf. Each newly started observation creates strong child
Checks. Separate Tasks may share an Execution; cancelling or expiring one
does not cancel the others.

The default Task budget is 60 seconds, maximum 600 seconds. Execution wall time
is independently limited to 600 seconds, with 8 dependency depth, 64
observations and 128 invocations. Child Check Tasks receive the remaining
Execution budget, capped at the Check service's 120 seconds. Last-owner
cancellation cancels child Tasks, never another owner's worker.

New artifacts use the [artifact contracts](../../docs/artifact-contracts.md).
`bindObjectiveService` in `objective-pilot` bridges legacy business APIs without
changing the new HTTP shapes. Legacy artifact/Check protocols remain separate.
