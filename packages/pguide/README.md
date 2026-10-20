# pguide

The Potential Guide CLI discovers and dispatches `pguide-<command>` executables.
It installs Pilot commands (`probe`, `scaffold`, `validate`), `config` and
`objectives` by default; its built-ins are `diagnose` and `complete`.
Regulation and supervision remain optional.

Install the default CLI and add optional commands as needed (use explicit
candidate versions when testing RCs):

```sh
npm install --global pguide
npm install --global @potential-guide/pguide-regulate
# Optional: @potential-guide/pguide-supervise
```

`pguide-pilot` owns `probe`, `scaffold`, `validate`; `pguide-regulate` owns
`regulate`, `continue`; `pguide-supervise` owns `supervise`; `pguide-objectives`
owns `objectives`. Existing options, output envelopes and exit codes are
unchanged. Standalone binaries (for example `pguide-probe`) work without the
main package. Missing commands name their installation package; duplicate
same-priority executables fail as ambiguous rather than picking arbitrarily.
Configured command directories take precedence over PATH.
When no external candidate or conflict exists, Pilot, config and objectives commands use
the installed dependencies' public bin exports through the current Node runtime.
This works even if npm/pnpm does not expose transitive bins; structured help and
diagnosis report source `bundled`. External incompatible commands or conflicts
are never hidden by this fallback. Explicitly installing the same command
packages alongside `pguide` does not add synthetic conflicts.
`@potential-guide/config` was renamed to `@potential-guide/pguide-config`:
replace explicit references and uninstall the old name to avoid duplicate shims.
See [migration and layers](../../docs/package-layering.md).

```sh
pguide scaffold pilot ./objective --check ready --problem not-ready
pguide validate pilot ./objective
# Commit the Pilot and its reference pages/checks in a clean Git repository
# with a credential-free HTTPS origin (file origins are supported for tests).
pguide probe --pilot ./objective --subject-file ./subject.json
pguide regulate --pilot ./objective --subject-file ./subject.json \
  --target terminal --agent fixture --agent-timeout-ms 30000
pguide continue <regulation-id>
```

Production `--pilot` accepts a committed local Pilot directory or a Git Objective
URI such as `git+https://github.com/owner/repo.git#objective/`.
Use `--revision <ref|full-commit>` with an explicit Git URI. Local paths also
accept `--revision <full-commit>`, including an older commit than checkout HEAD;
refs require an explicit Git URI. Local paths require a clean repository and
an origin. Their Objective identity remains the origin URI, while content is
read from the exact local commit snapshot, never unchecked working-tree bytes.
Objective identity excludes the commit while each observation's `versions`
records the directory tree OID; `sources[id]` separately records the retrieval
commit, directory, tree and independent repository support tree. A tree is never
used as a commit. Static `validate pilot` and scaffolding do not require
a Git commit.

## 目录与用户级 Objectives

`pguide-objectives` 是与 probe 等一致的可发现命令扩展。任意技术栈仓库的选定目录可以放置
`objectives.yaml`；不查找父目录、不递归发现、不需要 package.json。用户级清单位于
`pguide config path` 所示用户 config.yaml 的同级 `objectives.yaml`，与运行设置分离。

```yaml
schemaVersion: 1
objectives:
  standardize:
    description: 检查选定目录
    pilot: git+https://example.org/rules.git#directory-standard/
    inputSchema:
      type: object
      additionalProperties: false
      maxProperties: 0
    subject: |
      {"root": context.directory.absolutePath}
```

```powershell
pguide objectives list --cwd D:\project
pguide objectives show standardize --scope directory --cwd D:\project
pguide probe --objective standardize --scope directory --cwd D:\project
pguide regulate --objective standardize --scope directory --cwd D:\project --target terminal --agent local
pguide objectives set standardize --scope user --from D:\standardize.yaml
pguide objectives remove standardize --scope user
```

`--from` 是只含所选名称的完整 objectives.yaml；所有写操作要求显式 `--scope user|directory`，
校验后原子保存。相对 Pilot 路径相对于**目标清单文件**，不是调用目录或 `--from` 文件。
list/show 返回名称、描述、作用域、原始来源、清单内容 SHA-256、Pilot、inputSchema 和表达式，
不执行投影、检查、Agent 或远程版本解析。同名跨作用域选择必须明确消歧。

`--objective` 与 `--pilot`、`--subject-file` 互斥。声明输入使用 `--input-file <file|->`；
仅唯一空对象 Unit 可省略，非空值拒绝；普通可选字段对象不是 Unit。inputSchema 支持
Draft 2020-12 JSON 类型，与存储作用域正交。绑定先校验 input，再以受预算限制、无外部能力的
JSONata 确定性投影计算 subject，最后独立校验 Pilot domainSchema。只允许本地 `$defs` 引用。
上下文仅提供 repository.id、checkout.id/rootPath、directory.absolutePath/relativePath；
checkout.id 是主机名、规范化 Git common 目录和 checkout 路径的摘要，不仅凭路径跨设备合并，
也不是密码学设备身份证明。没有 Git 上下文时 repository/checkout 为 null；
表达式需要却缺失的字段报错，不收集凭据、环境变量或 package 身份。

仓库根目录的 `directory.relativePath` 是 `"."`，子目录使用仓库相对 `/` 路径。
仅 Git 的可识别非仓库诊断可返回 null；Git 缺失、超时、访问失败、损坏元数据或无效输出均为
`context-error`，不降级成非仓库。仅明确缺少 `remote.origin.url` 时使用本地 common Git
目录的 file 身份；origin 解析或读取失败不替换身份。origin 支持无 user info、query、fragment
的 HTTPS/SSH/file URL；SCP-like 及其他非 URL 来源明确拒绝。Git 元数据命令有 5 秒边界。

Unit 省略判断采用保守充分条件，并实际验证 `{}`：const {}、单值 enum [{}]、
object/maxProperties: 0，或 properties 与 patternProperties 均未声明或为空且
additionalProperties: false 的 object。不能可靠证明为 Unit 的 schema 必须显式传 input，
即使它接受 `{}`；不会尝试求解任意 schema 等价。

清单没有 target，probe 只观察，regulate 的 target 来自请求，依赖阈值来自消费者。
continue schemaVersion 3 保存已选择的清单快照、上下文、输入、最终 subject、目录 ID、
取回 commit 和 tree，恢复不重新发现同名入口；旧 schemaVersion 2 记录明确拒绝并指导重新绑定。

### 来源与更新边界

目录 ID 统一以 `/` 结尾，仓库根目录写作 `git+https://host/repo.git#/`；入口为目录内部
pilot.yaml。Git manifest URI 不再接受；本地 CLI 输入仅对名称恰好为 pilot.yaml 的文件提供
入口转换，核心协议只保存目录 ID。其他文件不会被剪裁成目录身份。
默认远程 HEAD（远程默认分支）、本地 checkout HEAD；每次 withPilot 固定整个观察及依赖交接的
快照。Supervisor 在受控刷新边界重新绑定根与已发现依赖，更新需求 revision 并重新观察；
旧结果不能放行新需求，更新失败可见。目录内脚本、References、资源改变 tree，无关 commit
不改变 Pilot 自身 tree。全仓库 materialization 的目录外支持文件另由 repositoryTree 记录，
这是独立且保守的支持内容边界，不是 Pilot tree；环境、网络、动态安装仍不在 Git 内容哈希内，
跨仓库来源必须通过依赖绑定获得独立证据。符号链接、子模块不能 materialize，明确拒绝。

## JSON subjects from stdin and the Objective registry

`probe` and `regulate` accept a JSON object directly from stdin. Omit
`--subject-file` or explicitly use `--subject-file -`:

```sh
printf '%s\n' '{"repository":"/work/project"}' | pguide probe --pilot health
cat subject.json | pguide regulate --pilot health --subject-file - --target terminal
```

In PowerShell:

```powershell
'{"repository":"D:\\work\\project"}' | pguide probe --pilot health
Get-Content -Raw .\subject.json | pguide regulate --pilot health --target terminal
```

Input must be exactly one JSON object, without a wrapper; empty input, arrays,
scalars and malformed JSON fail explicitly. In an interactive terminal, provide
a file or pipe JSON instead of waiting for terminal input. An explicit file
continues to take precedence over piped input.
When input is missing (an interactive terminal or empty input), both commands
include subject input guidance with the selected Pilot's complete `domainSchema`
as indented JSON. The schema describes required fields, types, nested objects,
defaults and other constraints; it is not itself a subject to submit. Save a
matching JSON object to `subject.json` and pass `--subject-file subject.json`, or
pipe that object to stdin. `--format json` includes this information in a
structured `guidance` field alongside the error. The command still exits with
code 2 without running checks or starting an Agent. The Pilot must be loadable
from its Git snapshot to provide schema guidance; source errors remain explicit.

旧 config.objectives 仅表示来源别名，不是带输入和投影的声明。新增/更新旧别名命令已退役；
list-objectives 明确标记 legacy-source-alias，remove-objective 仍可清理。迁移不会猜测 subject：

```sh
pguide config list-objectives
pguide objectives migrate health --scope user --from ./health.yaml --legacy-config ./old-config.yaml
pguide config remove-objective health
```

`migrate` 校验显式提供的新声明，先原子保存清单，再删除指定旧文件的同名别名；
其他别名保留。若第二次写入失败，两处数据仍可检查恢复，不会先删除旧数据。
旧配置仍可只读加载：

```yaml
schemaVersion: 2
objectives:
  health: git+https://github.com/owner/repo.git#objective/
```

Registration is optional: unregistered paths and Git URIs remain valid inputs.
Registry names are lowercase kebab-case. `--pilot health` uses a registered Objective;
`--pilot @health` additionally fails explicitly if the name is not registered. To
disambiguate a local path with the same name, use `./health` or an absolute path.
Targets are paths or Git URIs, not references to other registry entries. Manually configured
relative paths resolve against the invocation's `--cwd`, as other CLI paths do.
Objectives merge by name in user, project, then explicit configuration order.
Removing an override exposes any lower-scope registration; update/remove acts
only on the selected scope. Listing includes each effective registration's source.

Portfolio goal `pilot` fields accept the same names and `@name` syntax.
`--revision` and portfolio `revision` retain their normal meaning. Registration does not
change the clean Git snapshot requirement or Objective identity. Recovery records
store the resolved URI, exact commit and local source path, so later registry edits
do not retarget `continue`.

Dynamic cross-repository dependency checks are supported. Each repository has its own
snapshot, commit, checkout, and check routing, with all resources owned by the
same Scope. External repositories without an explicit pin resolve HEAD when
first requested in the current `withPilot` binding and remain immutable throughout
that binding. This is not a cross-source transaction. All source failures are
reported as `pilot-error` with exit code 2.

## Checks and localized guidance

### Local check and probe evidence

Evidence is enabled by default, independently of the existing `--report <path>`
JSON export. Each `probe` invocation creates a UUID directory under
`stateRoot/reports`. The default state root is `%LOCALAPPDATA%\pguide` on Windows
and `$XDG_STATE_HOME/pguide` (or `~/.local/state/pguide`) elsewhere.
`stateDirectory` and `PGUIDE_STATE_DIRECTORY` retain their existing semantics.

```yaml
schemaVersion: 2
reports:
  enabled: true
  directory: ./local-reports
```

For `probe`, directory precedence is `--report-dir`, `reports.directory`, then
`stateRoot/reports`; relative overrides resolve against `--cwd`. Configuration
layers merge `reports` per field. `--no-reports` or `reports.enabled: false`
disables evidence without disabling `--report`. Regulation and continuation
also honor the effective `reports` configuration. Evidence has no automatic
retention cleanup and is never uploaded.

Each run's `events.jsonl` records runtime metadata, check identities/attempts,
observations and termination. Each check attempt has its own
`checks/<checkRunId>/result.json`, containing the original envelope subject to
redaction/bounds. Cooperating checks write business facts to that directory's
separate `events.jsonl`, and optional proof files under `artifacts/`.
Every JSONL event has `schemaVersion: 1`, `time`, file-local increasing `seq`,
`event`, `data` and `runId`; check business streams also have `checkRunId` and
`attempt`. Root check events carry those check associations in `data`.

A finished invocation is **not** a business pass: inspect the result envelope's
status and `payload.ok`. Faults have `payload:null`; business failures retain
status 200 and `ok:false`. Cancellation records an interruption when the parent
can still write. A killed process or truncated stream may have no terminal
event; absence of a terminal event must never be interpreted as success.
Cleanup completes before the parent records run completion.

Subjects, environment snapshots, command arguments, stderr, and Agent
conversations are not automatically persisted. Sensitive field names are
redacted; credential values under sensitive subject keys are also removed from
later text evidence. This is not a general DLP filter: check authors must emit
only safe business facts and explicitly safe artifacts. JSONL files and result
files are bounded to approximately 1 MiB; long values/deep structures use
`[TRUNCATED]`, oversized results carry `truncated:true`, and full streams end
with `evidence.truncated` plus a stderr warning. Evidence write failures are
explicit errors, never silently successful persistence.

The bundled monorepo, machine-health, setup and self-check executables, and
newly scaffolded checks, support standalone evidence through `--report-dir`
and `--no-reports`. Standalone checks use the default state root, not pguide's
configuration loader. Source and bundled transport runtimes share the same
generated evidence implementation. Nested setup fixtures suppress their own
ephemeral evidence; their owning check retains safe phase/assertion facts.

Scaffolding generates `pilot.yaml`, localized `references/**/<language>.md`,
Node checks at `checks/<check-id>/run.js`, and a self-contained
`runtime/evidence.mjs`. Commit all these generated files. Checks receive the **subject
itself** as JSON on stdin, not a wrapper. Stdout is one JSON envelope:

```json
{"status":200,"payload":{"ok":false,"problems":[{"kind":"internal","id":"not-ready","parameters":{}}]},"message":""}
```

Business failure exits zero and has `ok:false`; success is
`{"status":200,"payload":{"ok":true,"problems":[]},"message":""}`.
An invocation failure uses `{"status":503,"payload":null,"message":"Probe unavailable"}`
and never establishes a trustworthy level. Diagnostic logs belong on stderr.
Pilot observations preserve every same-level problem, the localized gap summary,
and exact source versions. Internal problems have full scoped references;
dependency problems instead carry `objectiveId`, projected `subject`,
`expectedLevelId` and `currentLevelId`, without ID/ref/parameters.
The observation's current level always belongs to the consumer Objective.
See [dependency probe APIs and process binding](../objective-pilot/README.md#objective-level-checks-and-dependency-probes).

Reference pages require `title` and a nonempty `description` of at most 200
Unicode code points. Optional `references` defaults to `[]`. Guidance belongs
in the Markdown body. `--language` selects localized Wiki guidance;
dependency subject projection belongs to the check script.

Snapshot materialization reads the complete pinned repository with one recursive
file listing and sequential binary-safe Git batches, not a new Git process per
file. This preserves sibling resources and exact commit contents without running
checkout filters or relying on archive attributes. Symlinks and submodules remain
unsupported for executable snapshots. Preparation (clone, references and
materialization) has a separate 60000 ms deadline; expiry is an explicit
`pilot-error`, with owned command/cache cleanup, not a business observation.
Library callers can set `withPilot`'s `preparationTimeoutMs`; the timer stops
before the consumer starts, so check and Agent execution retain their own budgets.

## Configuration and recovery migration

Text usage (`pguide` or `pguide --help`) lists discovered command names without
executing external metadata probes. Use `pguide <command> --help` for details;
`pguide --help --format json` retains verified command compatibility metadata.
Official command launchers load business implementations only when executing a
command, not when answering metadata or detailed-help requests. Every official
command's text help includes its purpose, arguments/options, examples and shared
global options. `config <operation> --help` documents individual configuration
operations without reading or changing configuration. Dispatch still verifies the
selected command's protocol; help output is not a readiness check.

Configuration now requires:

```yaml
schemaVersion: 2
defaultAgent: fixture
agentExecutionLimits:
  timeoutMs: 30000
regulationStrategy:
  quota: { timeoutMs: 300000, maxAgentRuns: 10, maxStallRuns: 3 }
  probe: { timeoutMs: 30000, retry: { maxRetries: 0, delayMs: 0 } }
agents:
  fixture:
    type: acp
    connection: { protocolVersion: "1" }
    transport: { type: stdio, command: your-acp-agent }
```

Version 1 configuration and recovery records are **incompatible** and rejected
explicitly. Replace `--guide` with `--pilot`, `scaffold guide`/`validate guide`
with `scaffold pilot`/`validate pilot`, and migrate checks to the envelope
protocol. Remove `limits.maxIterations`, `limits.maxStalledIterations`,
`--max-iterations`, `--max-stalled-iterations`, and whole-loop `--timeout`.
`agentExecutionLimits.timeoutMs` / `--agent-timeout-ms` applies separately to each
Agent execution, including connection and session startup. Each regulation is one bounded run.
Optional `regulationStrategy.quota` defaults to a 300000 ms whole-run timeout,
10 Agent runs, and 3 stalled runs. Optional `regulationStrategy.probe` controls
per-observation timeouts and finite retries/delays; its defaults are a 30000 ms
timeout and zero retries. Probe retries apply to retryable invocation failures,
not business problems. Remove legacy `mode` and `effectTtlMs`; ongoing scheduling
belongs to portfolio supervision, not regulation.

`regulationStrategy.probe.timeoutMs` also configures each Git Pilot check process
used by `probe`, `regulate`/`continue`, and supervisor observation/worker runtimes.
The process default remains 30000 ms. During regulation the same setting also bounds
the whole observation, so all checks in that observation must fit that separate
budget; a larger process limit does not extend the regulation quota or Agent limit.
Checks receive runtime-owned `PGUIDE_PROBE_TIMEOUT_MS` metadata. For local
`pguide-setup`, an explicitly coordinated 60000 ms subject and 75000 ms probe
budget enable a longer bounded run; configure both, with probe retries still zero.
Nested Git Pilot source caches live under the invoking check's
`PGUIDE_PROBE_TEMP_DIR` when present (otherwise the normal project cache is used).
This keeps them inside the parent's cleanup scope, including forced cancellation.
Use paths with Windows Git headroom: a process timeout opt-in does not remove
Windows Git path-length limits.

Normal outcomes are `target-reached` (exit 0), `exhausted` (exit 5),
`authorization-required` (exit 3), and `dependency-required` (exit 3).
The last variant carries all dependency problems from the latest observation and
does not call the current Agent, even when internal problems are also present.
Typed 4xx/5xx invocation errors are failures,
not normal outcomes. The strategy is persisted and `continue` restores it
rather than silently adopting changed current configuration.

The Agent receives the subject, target, **complete observation**, and execution
limits. It owns task organization. Completed execution triggers re-observation;
invocation failure does not trigger repair. SIGINT/SIGTERM interrupts regulation.
New recovery records use schema 2, pin the Pilot URI/commit and subject digest,
and persist complete observation envelopes, Agent outcomes, and confirmed
protocol session identities before prompting. `continue` starts a fresh feedback loop against
that pinned recipe and resumes the recorded session when repair is needed.
Each `continue` is an explicit new run, preserving the pinned recipe and
relevant progress history; it does not restart an exhausted run automatically.
Session IDs in older schema 2 attempts are also recognized. A failed resume
never silently starts a new session. If no real session ID was saved,
`requirements.sessionResume: true` reports an explicit failure; otherwise a
new session is recorded with `resumeMode: new-without-session-id`. Already
satisfied objectives need no Agent session. It does not replay a selected
problem or assume an old observation is current.
Local inputs additionally persist `sourcePath` as environment metadata, never
as Objective identity. Recovery prefers that existing local source while
verifying the exact stored identity and commit. If the checkout cannot supply
the pinned commit, recovery fails explicitly rather than selecting a newer
version. When that path no longer exists, only the exact stored origin commit
is attempted; unpublished commits may therefore be unavailable.
Profiles inherit credentials by environment-variable name only.

## Explicit run permissions

Configuration optionally contains `regulationPermissions`. Omission denies all
ACP permission requests. Administrators define a ceiling of named rules and
explicitly activate a subset in `grants`; neither subjects, model plans, tool
titles nor capability labels grant authority:

```yaml
regulationPermissions:
  ceiling:
    - id: edit-result
      operation: edit
      resources: ['D:\work\project\result.json']
    - id: read-input
      operation: read
      resources: ['D:\work\project\input.json']
    - id: verify
      operation: execute
      command: 'node verify.mjs'
  grants: [edit-result, read-input]
```

Use absolute paths appropriate to your OS. Resources identify **exact files or
directories**, never recursive roots or glob patterns. All requested paths must
match granted paths both lexically and after realpath resolution; creating a
file requires an existing parent. Configure canonical paths rather than symlink
aliases, which are rejected to prevent rebinding between Agent invocations.
A directory rule does not authorize its
children. Every apply-patch Add/Update/Delete target, Move destination and ACP
location is checked. Missing paths, unknown tool kinds, unrecognized raw input,
traversal and changed symlink destinations fail closed. Structured file input is
`{path}` for read or `{path, content?}` for edit; edits also accept an apply_patch
string or `{patch}`. Execute input is only `{command}` and must match the complete
configured command exactly: no shell-prefix, wildcard, or cwd-based allowances.
Unsupported Agent argument shapes require explicit adapter support, not looser rules.
Copilot's `{fileName, diff}` permission input is also supported for single-file
unified Git diffs: the absolute filename, all diff headers and every ACP location
must agree. Creation/deletion null-file headers are recognized; renames,
multi-file diffs, symlink modes, quoted/ambiguous paths and malformed hunks are denied.

Only an offered `allow_once` option is selected. Individual denials do not kill
the prompt: the Agent can try alternatives, and the regulator re-observes.
Verified target/progress beats a denial; otherwise an unresolved request normally
returns `authorization-required` with safe request metadata. Hard quotas still
apply. Events exclude raw commands and model rationale. Permission snapshots and
requests are persisted per attempt. `continue` keeps the pinned recipe and limits
but **reloads the current configuration ceiling and grants**, not stale saved
authority. Edit the complete setting using
`pguide config set regulationPermissions '<JSON or YAML object>' --scope user`;
`pguide config get regulationPermissions` reads it. Project and explicit config
follow normal configuration precedence; protect all config sources as trusted
administrative inputs and do not authorize Agents to edit them.
Execution prompts include only the current effective grants, not the full ceiling,
and tell resumed Agents to seek a fresh host decision rather than treating old
session denials as current policy. Prose about being blocked never grants
authority or substitutes for an actual permission request.

Supervision reloads these administrative settings outside the planner queue.
Permission changes replace execution snapshots and revoke stale runs; denied
requests inform planning but planners cannot approve them.

**This is an ACP authorization boundary, not a sandbox or malicious-Agent
containment.** Exact shell commands can still have broad effects. An Agent can
perform actions without asking ACP, especially when its profile includes
`--allow-all-tools`, `--allow-tool=write`, or equivalent preauthorization flags.
Remove those flags when relying on this mediation. Pilot checks, Agent runtime,
administrative config and allowed commands remain trusted.
## Protocol selection and legacy ACP profiles

Each new profile uses a top-level `type: acp | ahp`. `connection` contains
protocol-specific settings, while `transport.type` independently selects the
transport. The old ACP shape `connection: { type: acp, protocolVersion: "1" }`
with a valid stdio transport is still readable, including in schema 2 recovery
records. It is normalized to the top-level form when loaded, edited or saved.
Schema 2 is retained: no migration is required for legal existing ACP profiles.
Mixed new/old discriminants, missing protocol selectors, and ACP/AHP field
combinations are rejected, not silently defaulted. `--agent` and `defaultAgent`
always select the local profile, not a Host product.

## AHP Host support

The adapter uses the official `@microsoft/agent-host-protocol` SDK **1.0.0**,
offering exactly the configured wire version **1.0.0** or **0.9.0**. A newer
Host must accept that offered version under AHP's caret-compatibility rules;
a different negotiated value fails explicitly. No Host/version combination
is claimed as real-world verified by the automated tests.

```yaml
schemaVersion: 2
defaultAgent: repair
agents:
  repair:
    type: ahp
    connection:
      protocolVersion: "1.0.0"
      agent: "<advertised-provider-id>"
    transport:
      type: websocket
      url: ws://127.0.0.1:12345
    authentication:
      type: query-token
      parameter: tkn
      tokenEnv: AHP_CONNECTION_TOKEN
    requirements:
      sessionResume: true
```

Replace the address, version and provider with explicitly authorized Host
settings. The adapter does not discover endpoints, start a Host, connect to
editor-internal named pipes, select unrelated sessions, or fall back to ACP.
Only WebSocket JSON-RPC text frames are supported. Use `wss` for remote hosts;
unencrypted `ws` is intended for trusted local connections. Credential-bearing
URLs (userinfo, query, fragment) are rejected. Endpoint access tokens are read
from `tokenEnv` and added to the configured query parameter only in memory.
This is transport authentication, not an AHP-wide bearer convention.
Use `authentication: { type: none }` or omit it for an already-secured endpoint.
Header authentication is not supported by the SDK's global WebSocket transport.

If the Agent needs protocol-level resource credentials, add
`authentication.resources: [{ resource: "<advertised-resource>", tokenEnv: AHP_RESOURCE_TOKEN }]`
to either authentication type. These are sent with AHP `authenticate` only
when the selected Agent advertised that exact protected resource. pguide does
not acquire/copy tokens, perform interactive OAuth, or automatically approve
tools/input requests. Host-owned existing authentication may be sufficient;
`AuthRequired` errors require explicit credential preparation. Tokens must
never be placed in the profile, command line, recovery record or evidence.

The Host must advertise the selected provider, implement `resourceResolve`,
accept `createSession` with one working directory, expose a confirmed session with
its default chat, and support session/chat `subscribe`, `dispatchAction` and
the standard turn lifecycle. AHP has no ACP-style `loadSession` capability:
resume is subscription to the original retained session and chat, validated
against their authoritative state. Missing capabilities/methods fail explicitly.
`pguide diagnose agent repair` checks negotiation/provider/authentication
without creating a session or sending a repair.

For a new session, the execution directory is the CLI's absolute `--cwd` as a
file URI, resolved on the **Host** using `resourceResolve`. The Host must be
able to access that path and confirm the canonical directory in the session
and chat; a different target is rejected before dispatch. There is no implicit
local-to-remote path translation. Use the corresponding Host-side path when
the CLI and Host share filesystem semantics. Subject paths must also be
meaningful to the Host. On recovery the saved canonical directory is pinned;
changing current configuration or `--cwd` does not retarget that session.

AHP session URIs are client-chosen per the specification, but only a successful
Host `createSession` response establishes their existence. pguide saves that
confirmed session identity, the default chat URI, canonical directory and the
next turn ID **before** sending a repair. It never uses a generated URI alone
as evidence of session creation. `continue` re-observes first, then subscribes
to the original identities only if repair is still necessary. Missing sessions,
changed providers/directories, active/queued/background execution or a previous
dispatch without a retained terminal turn fail closed. No replacement chat,
session or automatic reconnect/replay is attempted after an uncertain dispatch.

Host chat URIs remain exact identities, including authority forms such as
`ahp-chat://default/<encoded-session>`; the adapter validates the URI scheme
without rewriting it or requiring a UUID-only path. Session catalogue membership
and the pinned original identity are still required. Some Hosts leave a confirmed
session in `creating` until the first send materializes its backend. A subscribable
default chat with verified provider/directory, no turn history and no active,
queued or background work can accept that initial turn without first waiting for
`ready`. Failed/invalid lifecycle states still fail explicitly; readiness is not
used to bypass any execution-context or recovery checks.

Only a Host-confirmed terminal turn completes an invocation. Agent text is not
target evidence: the Regulator always re-observes. Errors and unexpected turn
states fail; input or resource-authentication requests return a blocked outcome
and request cancellation without approving anything. Tool permission requests
use the conservative policy described below. Output is bounded to 4 MiB per
execution. Per-Agent deadlines cover connection, authentication, directory
resolution and session setup as well as execution; the regulation quota remains
independent. Cancellation dispatches `chat/turnCancelled` only for the owned
turn. Cleanup allows at most 250 ms for acknowledgement, records
`pguide/ahp-interruption` in the transcript with `cancellationSent`,
`remoteStopConfirmed` and `executionState`, and closes only the client's
connection. An unconfirmed remote stop remains **uncertain**; inspect the
original chat before explicit continuation. Late results cannot become success.
No shared Host or unrelated session is stopped or disposed.

AHP 1.0 tool confirmations do not provide ACP's authoritative operation kind
or `allow_once` option semantics. `toolName` is diagnostic, `toolInput` may be
opaque/referenced and file edits are previews, not a complete permission scope.
The adapter therefore **never guesses** read/edit/execute authority from those
fields and never treats an ordinary `approve` option as a single-use grant.
The default (or explicit `confirmations: deny`) remains deny-by-default.
For supervised runs only, an AHP profile can set `confirmations: external`:
pguide leaves each execution/result confirmation pending for a human using a
trusted client already connected to the same Host and session. It sends no
confirmation, chooses no option, and converts no configured grant into approval.
The transcript records `pguide/ahp-external-confirmation` with the exact
session/chat/turn/toolCall/phase identifiers, without credentials or tool input.
The human must verify the full native request and choose only a single-request
decision, not session-wide/always approval. This setting does not open a UI,
connect another client, or authorize any request. Do not enable it without an
available human client. Waiting consumes the existing execution/run timeout;
cancel, disconnect and target-directory guards remain active. A later Host
decision is not success: the regulator must still re-observe the Objective.
The selected mode is saved with the execution recipe, not silently enabled by
`continue`. ACP profiles do not accept this AHP-only setting.
The wire action does not authenticate a human or prove single-use semantics;
external mode relies on the user's trusted Host/client for that decision.
Host-observed denial is recorded as `external-ahp-confirmation-denied` and,
without verified progress, ends with `authorization-required` rather than
silently treating refusal as a successful repair.
Even a configured file/command grant cannot automatically approve an
unclassifiable AHP request. In the default deny mode, execution/result
confirmations receive the official
`chat/toolCallConfirmed` / `chat/toolCallResultConfirmed` denial with
`approved: false`; safe `unknown` authorization requests and
`pguide/permission_decision` records explain the unsupported semantics.
The turn remains live so the Agent may try an authorized alternative. The
Regulator re-observes after terminal completion: verified target/progress wins,
otherwise an unresolved request yields `authorization-required` (exit 3).
`continue` reloads current permissions and never reuses old session authority.
This fail-closed limitation is not a Host sandbox: a preauthorized Agent can
still perform operations that it never asks the client to confirm. Supporting
positive AHP grant decisions requires a separately verified structured Host
permission/one-use contract; no product-specific or invented extension is used.

VS Code is a candidate reference Host, not a protocol discriminator. Its
`code agent host --help` documents externally reachable Host setup. Prefer a
separately owned `--new-instance --foreground` Host for isolated validation;
never use `--replace`/`kill` on shared Hosts. `code agent endpoints` includes
credentials and must not be printed or committed as evidence. Editor session
availability alone does not establish an externally usable WebSocket endpoint.

## Portfolio supervision

`pguide supervise --portfolio-file portfolio.json --planner strategist` observes
the portfolio and asks the configured ACP/AHP planning Agent for a priority queue
once, without executing repairs. Add `--execute` to continuously re-observe each
goal at its configured interval and coordinate one-shot regulation runs until
SIGINT/SIGTERM. `--execute --duration-ms 5000` bounds supervision and waits for
active processes to stop before returning.

Portfolio files require **schema 3**; old schemas and defensive-threshold
portfolios are rejected:

```json
{
  "schemaVersion": 3,
  "goals": [{
    "id": "service",
    "pilot": "git+https://github.com/example/service.git#objective/",
    "subject": {},
    "targetLevel": "terminal",
    "priority": 1,
    "observationIntervalMs": 30000,
    "requirements": ["typescript"]
  }],
  "resources": [{
    "id": "worker-1",
    "agent": "implementer",
    "capacity": 1,
    "capabilities": ["typescript"]
  }]
}
```

Goals accept an optional pinned `revision`; Pilot sources follow the same
committed-snapshot rules as `probe`. Both `strategist` and `implementer` refer
to profiles in configuration `agents`. `--planner` is required and does not
implicitly register the planner as an execution resource. An empty resource
array is permitted; unavailable capacity leaves work queued.

While executing, the CLI reloads the portfolio, Agent profiles, and source refs
between polling cycles (250–1000 ms plus source-loading time). Goal/subject/spec
changes replace immutable demands; resource changes reach the coordinator
without restarting. An explicit commit remains pinned, while an unpinned Git
URI or ref can advance to a new committed snapshot. Old observation scopes are
released after replacement. Invalid live updates stop supervision rather than
silently retaining stale inputs. Regulation quotas and execution timeout settings
are fixed at command startup.

The planner sees goals, observations, derived dependency candidates, previous
demands, and resource-free execution feedback—never the Agent inventory.
It must emit a JSON object through ACP `agent_message_chunk` text updates or
AHP terminal-turn markdown response parts:
`{"directives":[{"goalId":"service","priority":1}]}`. Optional directive fields
are `targetLevel` (a known level) and `requirements` (capability names).
Unknown or duplicate IDs, arbitrary commands, invalid JSON, refusal,
cancellation, excessive output, and timeout fail closed; there is no fallback
policy. Planning uses `agentExecutionLimits.timeoutMs`, separately from each
execution's timeout and regulation quota.

The coordinator alone binds demands to compatible resources, enforces capacity,
handles P0 preemption, and executes pinned regulations in separate OS processes.
Executing Agents can request capabilities using ACP notification method
`pguide/capability-request` with `{ "capability": "tool-name", "reason": "why" }`.
Requests are associated with the live demand and forwarded to subsequent
planning; they never provision resources or execute model-provided commands.
Completed work is not repeated merely because capacity changes; a fresh
observation can create new demand after regression. JSON output includes the
final queue, observations, and the latest 1000 coordinator events.

The command packages provide independent `pguide-probe`, `pguide-regulate`,
`pguide-continue`, `pguide-supervise`, `pguide-scaffold`, and `pguide-validate`
executables. The default `@potential-guide/pguide-config` dependency provides
`pguide-config`; `diagnose` and `complete` are built in. Executable discovery
uses `pguide-command-v1` metadata and preserves argument boundaries without
shell interpretation.
