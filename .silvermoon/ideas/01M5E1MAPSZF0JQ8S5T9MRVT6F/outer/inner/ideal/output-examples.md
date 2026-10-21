# CLI 实际输出样例

来自隔离 fixture 的 stdout/stderr 分流记录。`<FIXTURE>`、`<WORKTREE>`、`<NODE>`、`<UUID>`、`<OID>`、`<SHA256>` 是统一归一化标记，不是原始命令字面值。除这些替换和明确的截取标记外，保留原始大小写、标点和空行；`（空）` 表示该流确实为零字节。

所有普通 CLI 命令另带 `--cwd <FIXTURE>\repo --config <FIXTURE>\config.json`；`--format` 未列出表示没有传入该选项。独立命令通过 `node <当前工作树 dist 入口>` 启动；`pguide` 主入口对照使用指向同一工作树的配置目录 shim，未借用已安装版本。路径归一化不改变 URI 的 `file:///` 语法。

## 样例说明

输出长于 48 行的样例只保留前 48 行，尾部明确标记截取；问题清单引用的短输出均完整保留。完整场景覆盖及每种模式退出码见[覆盖矩阵](./output-coverage.md)。协议入口使用 stdin `not-json` 并禁用报告，故意只验证错误 envelope，不运行真实主机健康或安装操作。

## objectives-empty

### default

```text
pguide-objectives list
```

进程退出码：0。

stdout：

```text
{
  "objectives": [],
  "legacyAliases": []
}

```

stderr：

（空）

## objectives-one

### default

```text
pguide-objectives list
```

进程退出码：0。

stdout：

```text
{
  "objectives": [
    {
      "description": "Audit **label** | multiline\nsecond line",
      "objective": "git+file:///<FIXTURE>/repo#objective/",
      "inputSchema": {
        "const": {}
      },
      "subject": "{}",
      "name": "sample",
      "scope": "directory",
      "file": "<FIXTURE>\\repo\\objectives.yaml",
      "revision": "<SHA256>"
    }
  ],
  "legacyAliases": []
}

```

stderr：

（空）

## objectives-show

### default

```text
pguide-objectives show sample
```

进程退出码：0。

stdout：

```text
{
  "objectives": [
    {
      "description": "Audit **label** | multiline\nsecond line",
      "objective": "git+file:///<FIXTURE>/repo#objective/",
      "inputSchema": {
        "const": {}
      },
      "subject": "{}",
      "name": "sample",
      "scope": "directory",
      "file": "<FIXTURE>\\repo\\objectives.yaml",
      "revision": "<SHA256>"
    }
  ],
  "legacyAliases": []
}

```

stderr：

（空）

## objectives-many-legacy

### default

```text
pguide-objectives list
```

进程退出码：0。

stdout：

```text
{
  "objectives": [
    {
      "description": "Sample local declaration",
      "objective": "git+file:///<FIXTURE>/repo#objective/",
      "inputSchema": {
        "const": {}
      },
      "subject": "{}",
      "name": "sample",
      "scope": "user",
      "file": "<FIXTURE>\\user\\pguide\\objectives.yaml",
      "revision": "<SHA256>"
    },
    {
      "description": "Sample local declaration",
      "objective": "git+file:///<FIXTURE>/repo#objective/",
      "inputSchema": {
        "const": {}
      },
      "subject": "{}",
      "name": "sample",
      "scope": "directory",
      "file": "<FIXTURE>\\repo\\objectives.yaml",
      "revision": "<SHA256>"
    },
    {
      "description": "Second declaration",
      "objective": "git+file:///<FIXTURE>/repo#objective/",
      "inputSchema": {
        "const": {}
      },
      "subject": "{}",
      "name": "second",
      "scope": "directory",
      "file": "<FIXTURE>\\repo\\objectives.yaml",
      "revision": "<SHA256>"
    }
  ],
  "legacyAliases": [
    {
      "name": "old",
      "objective": "git+file:///<FIXTURE>/repo#objective/",
      "semantics": "legacy-source-alias",
      "file": "<FIXTURE>\\config.json"
    }
  ]
}
[截取：其余输出未列出]
```

stderr：

（空）

## objectives-ambiguous

### default

```text
pguide-objectives show sample
```

进程退出码：2。

stdout：

```text
Error: show requires one unambiguous name; specify --scope.

```

stderr：

（空）

## objectives-unknown-name

### default

```text
pguide-objectives show unknown
```

进程退出码：2。

stdout：

```text
Error: show requires one unambiguous name; specify --scope.

```

stderr：

（空）

## objectives-missing-scope

### default

```text
pguide-objectives remove sample
```

进程退出码：2。

stdout：

```text
Error: Expected set|remove|migrate <name> --scope user|directory; see --help.

```

stderr：

（空）

## agents-empty-list

### default

```text
pguide-agents list
```

进程退出码：0。

stdout：

```text
{}


```

stderr：

（空）

## agents-list

### default

```text
pguide-agents list
```

进程退出码：0。

stdout：

```text
fixture:
  profile:
    type: acp
    connection:
      protocolVersion: "1"
    transport:
      type: stdio
      command: <NODE>
      args:
        - <FIXTURE>\agent.mjs
  source:
    scope: project
    path: <FIXTURE>\repo\.pguide\agents.yaml


```

stderr：

（空）

## agents-show

### default

```text
pguide-agents show fixture
```

进程退出码：0。

stdout：

```text
profile:
  type: acp
  connection:
    protocolVersion: "1"
  transport:
    type: stdio
    command: <NODE>
    args:
      - <FIXTURE>\agent.mjs
source:
  scope: project
  path: <FIXTURE>\repo\.pguide\agents.yaml


```

stderr：

（空）

## agents-path

### default

```text
pguide-agents path
```

进程退出码：0。

stdout：

```text
user: <FIXTURE>\user\pguide\agents.yaml
project: <FIXTURE>\repo\.pguide\agents.yaml


```

stderr：

（空）

## agents-set

### default

```text
pguide-agents set fixture --scope project --from <FIXTURE>\profile.json
```

进程退出码：0。

stdout：

```text
project: <FIXTURE>\repo\.pguide\agents.yaml

```

stderr：

（空）

## agents-remove

### default

```text
pguide-agents remove fixture --scope project
```

进程退出码：0。

stdout：

```text
project: <FIXTURE>\repo\.pguide\agents.yaml

```

stderr：

（空）

## agents-edit

### default

```text
pguide-agents edit --scope project
```

进程退出码：0。

stdout：

```text
project: <FIXTURE>\repo\.pguide\agents.yaml

```

stderr：

（空）

## agents-migrate

### default

```text
pguide-agents migrate --scope project --legacy-config <FIXTURE>\repo\.pguide\config.yaml
```

进程退出码：0。

stdout：

```text
source: <FIXTURE>\repo\.pguide\config.yaml
destination: <FIXTURE>\repo\.pguide\agents.yaml
backup: <FIXTURE>\repo\.pguide\config.yaml.agents-migration.<UUID>.bak
names:
  - fixture


```

stderr：

（空）

## config-show

### default

```text
pguide-config show
```

进程退出码：0。

stdout：

```text
schemaVersion: 2
defaultAgent: fixture
stateDirectory: <FIXTURE>\state
regulationStrategy:
  quota:
    timeoutMs: 4000
    maxAgentRuns: 2
    maxStallRuns: 1


```

stderr：

（空）

### json

```text
pguide-config show --format json
```

进程退出码：0。

stdout：

```text
{
  "schemaVersion": 1,
  "config": {
    "schemaVersion": 2,
    "defaultAgent": "fixture",
    "stateDirectory": "<FIXTURE>\\state",
    "regulationStrategy": {
      "quota": {
        "timeoutMs": 4000,
        "maxAgentRuns": 2,
        "maxStallRuns": 1
      }
    }
  },
  "sources": {
    "schemaVersion": "<FIXTURE>\\config.json",
    "defaultAgent": "<FIXTURE>\\config.json",
    "stateDirectory": "<FIXTURE>\\config.json",
    "regulationStrategy": "<FIXTURE>\\config.json"
  }
}

```

stderr：

（空）

## config-path

### default

```text
pguide-config path
```

进程退出码：0。

stdout：

```text
user: <FIXTURE>\user\pguide\config.yaml
explicit: <FIXTURE>\config.json

```

stderr：

（空）

## config-get-scalar

### default

```text
pguide-config get defaultAgent
```

进程退出码：0。

stdout：

```text
fixture

```

stderr：

（空）

## config-get-object

### default

```text
pguide-config get regulationStrategy
```

进程退出码：0。

stdout：

```text
quota:
  timeoutMs: 4000
  maxAgentRuns: 2
  maxStallRuns: 1


```

stderr：

（空）

## config-edit

### default

```text
pguide-config edit --scope explicit
```

进程退出码：0。

stdout：

（空）

stderr：

（空）

### json

```text
pguide-config edit --scope explicit --format json
```

进程退出码：0。

stdout：

（空）

stderr：

（空）

## config-set

### default

```text
pguide-config set defaultAgent fixture --scope explicit
```

进程退出码：0。

stdout：

```text
Updated <FIXTURE>\config.json.

```

stderr：

（空）

## config-unset

### default

```text
pguide-config unset defaultAgent --scope explicit
```

进程退出码：0。

stdout：

```text
Updated <FIXTURE>\config.json.

```

stderr：

（空）

## config-list-objectives

### default

```text
pguide-config list-objectives
```

进程退出码：0。

stdout：

```text
No registered Objectives.

```

stderr：

（空）

## config-list-legacy

### default

```text
pguide-config list-objectives
```

进程退出码：0。

stdout：

```text
old (legacy source alias)
  Location: git+file:///<FIXTURE>/repo#objective/
  Source:   <FIXTURE>\config.json

```

stderr：

（空）

## objectives-set

### default

```text
pguide-objectives set sample --scope directory --from <FIXTURE>\declaration.json
```

进程退出码：0。

stdout：

```text
set: sample (<FIXTURE>\repo\objectives.yaml)

```

stderr：

（空）

## objectives-remove

### default

```text
pguide-objectives remove sample --scope directory
```

进程退出码：0。

stdout：

```text
remove: sample (<FIXTURE>\repo\objectives.yaml)

```

stderr：

（空）

## objectives-migrate

### default

```text
pguide-objectives migrate sample --scope directory --from <FIXTURE>\declaration.json --legacy-config <FIXTURE>\legacy-config.json
```

进程退出码：0。

stdout：

```text
migrate: sample (<FIXTURE>\repo\objectives.yaml)

```

stderr：

（空）

## probe-actionable-gap

### default

```text
pguide-probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --no-reports
```

进程退出码：0。

stdout：

```text
# Observation

Current level: `initial`

Synthetic marker is absent.

```

stderr：

（空）

## probe-terminal

### default

```text
pguide-probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --no-reports
```

进程退出码：0。

stdout：

```text
# Observation

Current level: `terminal`



```

stderr：

（空）

## probe-schema-guidance

### default

```text
pguide-probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --no-reports
```

进程退出码：2。

stdout：

```text
Error: Invalid subject for git+file:///<FIXTURE>/repo#objective/: [{"instancePath":"","keyword":"required","message":"must have required property 'name'"}].

```

stderr：

（空）

## probe-language-zh

### default

```text
pguide-probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --language zh-CN --no-reports
```

进程退出码：2。

stdout：

```text
Error: Unsupported language zh-CN for git+file:///<FIXTURE>/repo#objective/.

```

stderr：

（空）

## probe-invocation-failure

### default

```text
pguide-probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --no-reports
```

进程退出码：6。

stdout：

```text
Pilot invocation failed: Synthetic check invocation failed

```

stderr：

（空）

## probe-report

### default

```text
pguide-probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --report <FIXTURE>\observation-report.json --no-reports
```

进程退出码：0。

stdout：

```text
# Observation

Current level: `initial`

TODO: describe this problem.

```

stderr：

（空）

## regulate-stalled

### default

```text
pguide-regulate --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --target terminal --agent fixture
```

进程退出码：5。

stdout：

```text
Regulation <UUID>: exhausted.

```

stderr：

（空）

## continue-stalled

### default

```text
pguide-continue <UUID>
```

进程退出码：5。

stdout：

```text
Regulation <UUID>: exhausted.

```

stderr：

（空）

## regulate-terminal

### default

```text
pguide-regulate --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --target terminal --agent fixture
```

进程退出码：0。

stdout：

```text
Regulation <UUID>: target-reached.

```

stderr：

（空）

## regulate-invocation-failure

### default

```text
pguide-regulate --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --target terminal --agent fixture
```

进程退出码：6。

stdout：

```text
Error: Probe invocation failed: Synthetic check invocation failed

```

stderr：

（空）

## supervise-plan

### default

```text
pguide-supervise --portfolio-file <FIXTURE>\portfolio.json --planner fixture
```

进程退出码：0。

stdout：

```text
Planned 1 goals; 1 queued demands.

```

stderr：

（空）

## supervise-execute

### default

```text
pguide-supervise --portfolio-file <FIXTURE>\portfolio.json --planner fixture --execute --duration-ms 300
```

进程退出码：0。

stdout：

```text
Supervised 1 goals; 1 queued demands.

```

stderr：

（空）

## supervise-observation-failure

### default

```text
pguide-supervise --portfolio-file <FIXTURE>\portfolio.json --planner fixture
```

进程退出码：70。

stdout：

```text
Error: Observation failed for audit: Synthetic check invocation failed

```

stderr：

（空）

## diagnose

### default

```text
pguide diagnose
```

进程退出码：0。

stdout：

```text
pguide diagnosis: ok
Node: v24.11.1
Commands: 9

```

stderr：

（空）

## diagnose-agent

### default

```text
pguide diagnose agent fixture
```

进程退出码：0。

stdout：

```text
pguide diagnosis: ok
Node: v24.11.1
Commands: 9

```

stderr：

（空）

### json

```text
pguide diagnose agent fixture --format json
```

进程退出码：0。

stdout：

```text
{
  "schemaVersion": 1,
  "status": "ok",
  "node": "v24.11.1",
  "config": {
    "user": "<FIXTURE>\\user\\pguide\\config.yaml",
    "explicit": "<FIXTURE>\\config.json"
  },
  "commands": [
    {
      "command": "agents",
      "path": "<USERPROFILE>\\AppData\\Local\\pguide\\bin\\pguide-agents.cmd",
      "source": "PATH"
    },
    {
      "command": "config",
      "path": "<USERPROFILE>\\AppData\\Local\\pguide\\bin\\pguide-config.cmd",
      "source": "PATH"
    },
    {
      "command": "continue",
      "path": "<USERPROFILE>\\AppData\\Local\\pguide\\bin\\pguide-continue.cmd",
      "source": "PATH"
    },
    {
      "command": "objectives",
      "path": "<USERPROFILE>\\AppData\\Local\\pguide\\bin\\pguide-objectives.cmd",
      "source": "PATH"
    },
    {
      "command": "probe",
      "path": "<USERPROFILE>\\AppData\\Local\\pguide\\bin\\pguide-probe.cmd",
      "source": "PATH"
    },
    {
      "command": "regulate",
      "path": "<USERPROFILE>\\AppData\\Local\\pguide\\bin\\pguide-regulate.cmd",
      "source": "PATH"
    },
    {
      "command": "scaffold",
      "path": "<USERPROFILE>\\AppData\\Local\\pguide\\bin\\pguide-scaffold.cmd",
      "source": "PATH"
    },
    {
      "command": "supervise",
      "path": "<USERPROFILE>\\AppData\\Local\\pguide\\bin\\pguide-supervise.cmd",
      "source": "PATH"
[截取：其余输出未列出]
```

stderr：

（空）

## diagnose-conflict

### default

```text
pguide diagnose
```

进程退出码：2。

stdout：

```text
pguide diagnosis: conflicts
Node: v24.11.1
Commands: 8

```

stderr：

（空）

### json

```text
pguide diagnose --format json
```

进程退出码：2。

stdout：

```text
{
  "schemaVersion": 1,
  "status": "conflicts",
  "node": "v24.11.1",
  "config": {
    "user": "<FIXTURE>\\user\\pguide\\config.yaml",
    "explicit": "<FIXTURE>\\config.json"
  },
  "commands": [
    {
      "command": "agents",
      "path": "<FIXTURE>\\commands\\pguide-agents.cmd",
      "source": "configured"
    },
    {
      "command": "config",
      "path": "<FIXTURE>\\commands\\pguide-config.cmd",
      "source": "configured"
    },
    {
      "command": "continue",
      "path": "<FIXTURE>\\commands\\pguide-continue.cmd",
      "source": "configured"
    },
    {
      "command": "objectives",
      "path": "<FIXTURE>\\commands\\pguide-objectives.cmd",
      "source": "configured"
    },
    {
      "command": "regulate",
      "path": "<FIXTURE>\\commands\\pguide-regulate.cmd",
      "source": "configured"
    },
    {
      "command": "scaffold",
      "path": "<FIXTURE>\\commands\\pguide-scaffold.cmd",
      "source": "configured"
    },
    {
      "command": "supervise",
      "path": "<FIXTURE>\\commands\\pguide-supervise.cmd",
      "source": "configured"
    },
    {
      "command": "validate",
      "path": "<FIXTURE>\\commands\\pguide-validate.cmd",
      "source": "configured"
[截取：其余输出未列出]
```

stderr：

（空）

## dispatch-conflict

### default

```text
pguide probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json
```

进程退出码：2。

stdout：

```text
Error: Ambiguous command probe: <FIXTURE>\commands\pguide-probe.cmd, <FIXTURE>\commands-conflict\pguide-probe.cmd.

```

stderr：

（空）

## help-conflict

### default

```text
pguide --help
```

进程退出码：0。

stdout：

```text
pguide 0.4.0-rc.0 - Observe Objectives, repair gaps, and supervise portfolios.

Usage: pguide [global options] <command> [arguments]

Commands:
  complete     Generate shell completion
  diagnose     Diagnose configuration and commands
  agents       Manage independent user and project Agent resources
  config       Manage user/project configuration and Agent profiles
  continue     Continue a persisted Regulation
  objectives   Discover and manage user and directory Objective declarations
  regulate     Run Pilot regulation with per-Agent execution limits
  scaffold     Create an Objective Pilot skeleton
  supervise    Supervise an Objective portfolio
  validate     Validate an Objective Pilot

Examples:
  pguide config path
  pguide validate pilot .\objective\objective.yaml
  pguide probe --pilot .\objective --subject-file .\subject.json --format json

Help:
  pguide <command> --help     Detailed command usage and examples
  pguide --help --format json  Verify discovered command compatibility
  Text help lists commands without starting them.
  Conflicting commands: probe

Global options:
  --cwd <directory>       Configuration and relative-path context (default: current directory)
  --config <path>         Explicit config overlay (user -> project -> explicit)
  --format <format>       markdown | json (default: markdown)
  --color <mode>          auto | always | never (default: auto)
  --log-level <level>     error | warn | info | debug (default: warn)
  --help                  Show help without executing the command
  --version               Show command version

```

stderr：

（空）

## help-pguide

### default

```text
pguide --help
```

进程退出码：0。

stdout：

```text
pguide 0.4.0-rc.0 - Observe Objectives, repair gaps, and supervise portfolios.

Usage: pguide [global options] <command> [arguments]

Commands:
  complete     Generate shell completion
  diagnose     Diagnose configuration and commands
  agents       Manage independent user and project Agent resources
  config       Manage user/project configuration and Agent profiles
  continue     Continue a persisted Regulation
  objectives   Discover and manage user and directory Objective declarations
  probe        Observe an Objective Pilot
  regulate     Run Pilot regulation with per-Agent execution limits
  scaffold     Create an Objective Pilot skeleton
  supervise    Supervise an Objective portfolio
  validate     Validate an Objective Pilot

Examples:
  pguide config path
  pguide validate pilot .\objective\objective.yaml
  pguide probe --pilot .\objective --subject-file .\subject.json --format json

Help:
  pguide <command> --help     Detailed command usage and examples
  pguide --help --format json  Verify discovered command compatibility
  Text help lists commands without starting them.

Global options:
  --cwd <directory>       Configuration and relative-path context (default: current directory)
  --config <path>         Explicit config overlay (user -> project -> explicit)
  --format <format>       markdown | json (default: markdown)
  --color <mode>          auto | always | never (default: auto)
  --log-level <level>     error | warn | info | debug (default: warn)
  --help                  Show help without executing the command
  --version               Show command version

```

stderr：

（空）

## help-probe

### default

```text
pguide-probe --help
```

进程退出码：0。

stdout：

```text
Observe the current Objective level and all blocking problems. Does not run regulation.

Usage: pguide probe (--objective <name> | --pilot <directory|Git URI|legacy-alias>) [options]

Required:
  --pilot <source>        Committed path, Git URI, or registered Objective name

Options:
  --objective <name>     Select a declaration instead of --pilot
  --scope user|directory Disambiguate declaration scope
  --input-file <path|->  Declaration input; only Unit may omit it
  --subject-file <path|-> JSON subject (default: stdin); use - explicitly for stdin
  --revision <ref|commit> Pin source version; local paths require a full commit hash
  --language <tag>        Select localized references (default: Pilot language)
  --report <path>         Also save the complete JSON observation
  --report-dir <path>     Override the default local JSONL evidence directory
  --no-reports            Disable local evidence (does not disable --report)

Examples:
  pguide probe --pilot .\objective --subject-file .\subject.json
  pguide probe --pilot .\objective --subject-file - --format json
  Get-Content -Raw .\subject.json | pguide probe --pilot health --format json

Notes:
  Local Pilot repositories must be clean and committed. Checks may execute tools;
  a self-check Pilot includes one Agent sanity task. Read the Pilot before running.
  Exit 0 means observation succeeded, not that the Objective reached terminal.
  Manage declarations with pguide objectives; config aliases are legacy sources only.
  Use @name to require a registered Objective; bare names resolve when registered.
  Next: pguide regulate --help

Global options:
  --cwd <directory>       Configuration and relative-path context (default: current directory)
  --config <path>         Explicit config overlay (user -> project -> explicit)
  --format <format>       markdown | json (default: markdown)
  --color <mode>          auto | always | never (default: auto)
  --log-level <level>     error | warn | info | debug (default: warn)
  --help                  Show help without executing the command
  --version               Show command version

```

stderr：

（空）

### json

```text
pguide-probe --help --format json
```

进程退出码：0。

stdout：

```text
{
  "schemaVersion": 1,
  "command": "probe",
  "options": [
    "--pilot",
    "--subject-file",
    "--language",
    "--revision",
    "--report"
  ]
}

```

stderr：

（空）

## help-agents

### default

```text
pguide-agents --help
```

进程退出码：0。

stdout：

```text
Usage: pguide agents list|show|set|remove|edit|validate|path|migrate [name]

  list / show <name>       Effective profiles with scope and file provenance
  set <name> --from <file|->  Validate and replace a whole profile
  remove <name>            Remove only from the selected scope
  edit                     Edit a validated draft; failed edits preserve the original
  validate / path          Validate resources / show their locations
  migrate                  Move embedded profiles, preserving a source backup

Writes require --scope user|project. migrate accepts --legacy-config <file>
only for the main config beside that scope's agents.yaml. --config selects a
main configuration, never a third agents scope. Project profiles replace entire
same-name user profiles. Profiles contain credential references, never secrets.

Examples:
  pguide agents set local --from profile.yaml --scope project
  pguide agents migrate --scope user

Global options:
  --cwd <directory> Configuration and resource discovery context
  --config <path> Main config overlay only; never an Agent scope
  --format markdown|json
  --color auto|always|never
  --log-level error|warn|info|debug
  --help
  --version

```

stderr：

（空）

### json

```text
pguide-agents --help --format json
```

进程退出码：0。

stdout：

```text
{
  "schemaVersion": 1,
  "command": "agents",
  "subcommands": [
    "list",
    "show",
    "set",
    "remove",
    "edit",
    "validate",
    "path",
    "migrate"
  ],
  "resourceSchema": "https://shazhou-ww.github.io/potential-guide/schemas/agents/v1.json"
}

```

stderr：

（空）

## subhelp-agents

### default

```text
pguide-agents show --help
```

进程退出码：0。

stdout：

```text
Usage: pguide agents list|show|set|remove|edit|validate|path|migrate [name]

  list / show <name>       Effective profiles with scope and file provenance
  set <name> --from <file|->  Validate and replace a whole profile
  remove <name>            Remove only from the selected scope
  edit                     Edit a validated draft; failed edits preserve the original
  validate / path          Validate resources / show their locations
  migrate                  Move embedded profiles, preserving a source backup

Writes require --scope user|project. migrate accepts --legacy-config <file>
only for the main config beside that scope's agents.yaml. --config selects a
main configuration, never a third agents scope. Project profiles replace entire
same-name user profiles. Profiles contain credential references, never secrets.

Examples:
  pguide agents set local --from profile.yaml --scope project
  pguide agents migrate --scope user

Global options:
  --cwd <directory> Configuration and resource discovery context
  --config <path> Main config overlay only; never an Agent scope
  --format markdown|json
  --color auto|always|never
  --log-level error|warn|info|debug
  --help
  --version

```

stderr：

（空）

## help-objectives

### default

```text
pguide-objectives --help
```

进程退出码：0。

stdout：

```text
List/show declarations without evaluation or remote resolution; set/remove/migrate require explicit scope.

Usage: pguide objectives list|show|set|remove|migrate [name] [--scope user|directory]

Options:
  --from <file> Complete single-entry objectives.yaml for set/migrate
  --legacy-config <file> Explicit legacy config for migrate

Global options:
  --cwd <directory>       Configuration and relative-path context (default: current directory)
  --config <path>         Explicit config overlay (user -> project -> explicit)
  --format <format>       markdown | json (default: markdown)
  --color <mode>          auto | always | never (default: auto)
  --log-level <level>     error | warn | info | debug (default: warn)
  --help                  Show help without executing the command
  --version               Show command version

```

stderr：

（空）

### json

```text
pguide-objectives --help --format json
```

进程退出码：0。

stdout：

```text
{
  "schemaVersion": 1,
  "command": "objectives"
}

```

stderr：

（空）

## help-config

### default

```text
pguide-config --help
```

进程退出码：0。

stdout：

```text
Inspect and manage pguide configuration and Agent profiles.

Usage: pguide config <subcommand> [arguments] [options]

Subcommands:
  show
      Show the merged configuration with sensitive values redacted.
  path
      Show user, discovered project and explicit configuration paths.
  validate
      Validate schemaVersion 2 and the effective configuration; does not connect to Agents.
  edit [--scope <scope>]
      Edit via VISUAL or EDITOR, then validate and atomically save the selected file.
  get <key>
      Read an effective value; dot-separated keys are supported.
  set <key> <value> [--scope <scope>]
      Set a top-level key; the quoted value is parsed as YAML, not a secret store.
  unset <key> [--scope <scope>]
      Remove a top-level key from the selected file; schemaVersion cannot be removed.
  list-agents
      Retired: use pguide agents list; embedded profiles require explicit migrate.
  show-agent <name>
      Retired: use pguide agents show <name>.
  add-agent <name> <source|-> [--scope <scope>]
      Retired: use pguide agents set <name> --from <file|-> --scope user|project.
  update-agent <name> <source|-> [--scope <scope>]
      Retired: use pguide agents set <name> --from <file|-> --scope user|project.
  remove-agent <name> [--scope <scope>]
      Retired: use pguide agents remove <name> --scope user|project.
  list-objectives
      List legacy source aliases (not declarations), locations and configuration origins.
  add-objective <name> <path|Git URI> [--scope <scope>]
      Retired: use pguide objectives set/migrate with explicit inputSchema and subject.
  update-objective <name> <path|Git URI> [--scope <scope>]
      Retired: use pguide objectives set/migrate; existing source aliases are read-only.
  remove-objective <name> [--scope <scope>]
      Remove an Objective name from the selected file, leaving other layers unchanged.

Configuration:
  Effective values merge user -> nearest project -> explicit --config.
  --scope <scope> applies to writes: user | project | explicit (default: project).
  --scope explicit requires --config <path>; reads always use the effective merge.
  Writes validate schemaVersion 2 before saving. Agent credentials stay in the
  Agent's login store or named environment variables, never profile literals.

Examples:
  pguide config path
  pguide config set defaultAgent local --scope user
[截取：其余输出未列出]
```

stderr：

（空）

## config-help-retired

### default

```text
pguide-config add-agent --help
```

进程退出码：0。

stdout：

```text
Retired: use pguide agents set <name> --from <file|-> --scope user|project.

Usage: pguide config add-agent <name> <source|-> [--scope <scope>]

Configuration:
  Effective values merge user -> nearest project -> explicit --config.
  --scope <scope> applies to writes: user | project | explicit (default: project).
  --scope explicit requires --config <path>; reads always use the effective merge.
  Writes validate schemaVersion 2 before saving. Agent credentials stay in the
  Agent's login store or named environment variables, never profile literals.

Examples:
  pguide config add-agent local .\agent.yaml --scope user

Notes:
  regulationStrategy configures finite regulation quotas and check deadlines;
  portfolio scheduling belongs to supervise. Validation alone does not prove
  Agent authentication or repair readiness. Use pguide diagnose agent <name>.
  Registered Objective names work in probe, regulate and portfolio goals;
  @name requires a registry match. Registry entries point to paths or Git URIs, not aliases.
  Run pguide config <subcommand> --help for operation-specific usage.

Global options:
  --cwd <directory>       Configuration and relative-path context (default: current directory)
  --config <path>         Explicit config overlay (user -> project -> explicit)
  --format <format>       markdown | json (default: markdown)
  --color <mode>          auto | always | never (default: auto)
  --log-level <level>     error | warn | info | debug (default: warn)
  --help                  Show help without executing the command
  --version               Show command version

```

stderr：

（空）

## help-supervise

### default

```text
pguide-supervise --help
```

进程退出码：0。

stdout：

```text
Observe an Objective portfolio and ask a planner to allocate Agent resources.

Usage: pguide supervise --portfolio-file <json> --planner <profile> [options]

Required:
  --portfolio-file <json> Portfolio schemaVersion 3 with goals and resources
  --planner <profile>     Existing Agent profile used for planning

Options:
  --execute               Run the coordinator and dispatch approved regulations
  --duration-ms <ms>      Stop after a positive duration; requires --execute

Examples:
  pguide supervise --portfolio-file .\portfolio.json --planner local --format json
  pguide supervise --portfolio-file .\portfolio.json --planner local --execute --duration-ms 60000

Notes:
  Without --execute, produces a plan without dispatching repairs; planning still uses an Agent.
  Live execution watches portfolio/config changes. Ctrl+C cancels the coordinator.

Global options:
  --cwd <directory>       Configuration and relative-path context (default: current directory)
  --config <path>         Explicit config overlay (user -> project -> explicit)
  --format <format>       markdown | json (default: markdown)
  --color <mode>          auto | always | never (default: auto)
  --log-level <level>     error | warn | info | debug (default: warn)
  --help                  Show help without executing the command
  --version               Show command version

```

stderr：

（空）

### json

```text
pguide-supervise --help --format json
```

进程退出码：0。

stdout：

```text
{
  "schemaVersion": 1,
  "command": "supervise"
}

```

stderr：

（空）

## validate-valid

### default

```text
pguide-validate pilot <FIXTURE>\repo\objective
```

进程退出码：0。

stdout：

```text
Valid Objective Pilot: file:///<FIXTURE>/repo/objective/

```

stderr：

（空）

## validate-unknown-option

### default

```text
pguide-validate pilot <FIXTURE>\repo\objective --bogus
```

进程退出码：0。

stdout：

```text
Valid Objective Pilot: file:///<FIXTURE>/repo/objective/

```

stderr：

（空）

## validate-missing

### default

```text
pguide-validate pilot <FIXTURE>\absent
```

进程退出码：2。

stdout：

```text
Error: Missing objective.yaml. Legacy pilot.yaml is not read: use objective-contract-migrate --format manifest --input pilot.yaml --output objective.yaml, then commit the migrated source before rebinding.

```

stderr：

（空）

## scaffold-create

### default

```text
pguide-scaffold pilot <FIXTURE>\repo\objective --check ready --problem not-ready
```

进程退出码：0。

stdout：

```text
Created Objective Pilot skeleton at <FIXTURE>\repo\objective.

```

stderr：

（空）

## scaffold-exists

### default

```text
pguide-scaffold pilot <FIXTURE>\repo\objective
```

进程退出码：2。

stdout：

```text
Error: Scaffold destination must not exist or must be empty.

```

stderr：

（空）

## complete-powershell

### default

```text
pguide complete --shell powershell
```

进程退出码：0。

stdout：

```text
Register-ArgumentCompleter -Native -CommandName pguide -ScriptBlock { param($wordToComplete) 'probe','regulate','continue','supervise','scaffold','validate','config','agents','objectives','diagnose','complete' | Where-Object { $_ -like "$wordToComplete*" } }

```

stderr：

（空）

## migration-help

### default

```text
objective-contract-migrate --help
```

进程退出码：0。

stdout：

```text
objective-contract-migrate --format manifest|declarations|portfolio --input <file> --output <new-file> [--context-kind git|non-git] [--subjects-file <reviewed-name-to-expression.json>]
Input remains untouched. Output must not exist. Pinned source evidence is never rewritten.

```

stderr：

（空）

## migration-help-json

### default

```text
objective-contract-migrate --help --format json
```

进程退出码：0。

stdout：

```text
{"schemaVersion":1,"command":"objective-contract-migrate","usage":"objective-contract-migrate --format manifest|declarations|portfolio --input <file> --output <new-file> [--context-kind git|non-git] [--subjects-file <reviewed-name-to-expression.json>]","safety":"Input remains untouched. Output must not exist. Pinned source evidence is never rewritten."}

```

stderr：

（空）

## migration-invalid

### default

```text
objective-contract-migrate
```

进程退出码：1。

stdout：

（空）

stderr：

```text
Explicit --format, --input and --output are required.

```

## migration-manifest-valid

### default

```text
objective-contract-migrate --format manifest --input <FIXTURE>\legacy-manifest-valid.json --output <FIXTURE>\migrated-manifest.json
```

进程退出码：0。

stdout：

（空）

stderr：

（空）

## migration-manifest-existing

### default

```text
objective-contract-migrate --format manifest --input <FIXTURE>\legacy-manifest-valid.json --output <FIXTURE>\migrated-manifest.json
```

进程退出码：1。

stdout：

（空）

stderr：

```text
EEXIST: file already exists, open '<FIXTURE>\migrated-manifest.json'

```

## migration-declarations-success

### default

```text
objective-contract-migrate --format declarations --input <FIXTURE>\legacy-declarations-corrected.json --output <FIXTURE>\migrated-declarations.json
```

进程退出码：0。

stdout：

（空）

stderr：

（空）

## migration-portfolio-success

### default

```text
objective-contract-migrate --format portfolio --input <FIXTURE>\legacy-portfolio-corrected.json --output <FIXTURE>\migrated-portfolio.json
```

进程退出码：0。

stdout：

（空）

stderr：

（空）

## protocol-objective-devbox-health-system

### protocol

```text
node <WORKTREE>\packages\objective-devbox-health\checks\system\run.cjs --no-reports
```

进程退出码：0。

stdout：

```text
{"status":400,"payload":null,"message":"invalid-subject: malformed JSON."}

```

stderr：

（空）

## protocol-objective-pguide-setup-installation

### protocol

```text
node <WORKTREE>\packages\objective-pguide-setup\checks\installation\run.cjs --no-reports
```

进程退出码：0。

stdout：

```text
{"status":400,"payload":null,"message":"invalid-subject: expected JSON."}

```

stderr：

（空）

## protocol-objective-pguide-self-check-installation

### protocol

```text
node <WORKTREE>\packages\objective-pguide-self-check\checks\installation\run.cjs --no-reports
```

进程退出码：0。

stdout：

```text
{"status":400,"payload":null,"message":"invalid-subject: expected JSON."}

```

stderr：

（空）

## protocol-objective-monorepo-standard-structure

### protocol

```text
node <WORKTREE>\packages\objective-monorepo-standard\checks\structure\run.cjs --no-reports
```

进程退出码：0。

stdout：

```text
{"status":502,"payload":null,"message":"Monorepo observer invocation failed: Unexpected token 'o', \"not-json\" is not valid JSON"}

```

stderr：

（空）

## monorepo-wrapper-usage

### default

```text
node <WORKTREE>\packages\objective-monorepo-standard\check.mjs
```

进程退出码：2。

stdout：

（空）

stderr：

```text
Usage: node check.mjs structure|deliveries --subject-file <path>

```

## dispatch-normal-config

### default

```text
pguide config show
```

进程退出码：0。

stdout：

```text
schemaVersion: 2
defaultAgent: fixture
stateDirectory: <FIXTURE>\state
regulationStrategy:
  quota:
    timeoutMs: 4000
    maxAgentRuns: 2
    maxStallRuns: 1
commandDirectories:
  - <FIXTURE>\commands


```

stderr：

（空）

## dispatch-normal-agents

### default

```text
pguide agents list
```

进程退出码：0。

stdout：

```text
fixture:
  profile:
    type: acp
    connection:
      protocolVersion: "1"
    transport:
      type: stdio
      command: <NODE>
      args:
        - <FIXTURE>\agent.mjs
  source:
    scope: project
    path: <FIXTURE>\repo\.pguide\agents.yaml


```

stderr：

（空）

## dispatch-normal-objectives

### default

```text
pguide objectives list
```

进程退出码：0。

stdout：

```text
{
  "objectives": [],
  "legacyAliases": []
}

```

stderr：

（空）

## dispatch-normal-probe

### default

```text
pguide probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --no-reports
```

进程退出码：0。

stdout：

```text
# Observation

Current level: `initial`

TODO: describe this problem.

```

stderr：

（空）

## dispatch-normal-regulate

### default

```text
pguide regulate --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --target terminal --agent fixture
```

进程退出码：5。

stdout：

```text
Regulation <UUID>: exhausted.

```

stderr：

（空）

## dispatch-normal-continue

### default

```text
pguide continue <UUID>
```

进程退出码：5。

stdout：

```text
Regulation <UUID>: exhausted.

```

stderr：

（空）

## dispatch-normal-supervise

### default

```text
pguide supervise --portfolio-file <FIXTURE>\portfolio.json --planner fixture
```

进程退出码：0。

stdout：

```text
Planned 1 goals; 1 queued demands.

```

stderr：

（空）

## dispatch-normal-validate

### default

```text
pguide validate pilot <FIXTURE>\repo\objective
```

进程退出码：0。

stdout：

```text
Valid Objective Pilot: file:///<FIXTURE>/repo/objective/

```

stderr：

（空）

## dispatch-normal-scaffold

### default

```text
pguide scaffold pilot <FIXTURE>\top-scaffold-default
```

进程退出码：0。

stdout：

```text
Created Objective Pilot skeleton at <FIXTURE>\top-scaffold-default.

```

stderr：

（空）

## config-help-example-section

以下是 config 总帮助中 Examples 分区的原文摘录：

```text
Examples:
  pguide config path
  pguide config set defaultAgent local --scope user
  pguide config add-agent local .\agent.yaml --scope user
  pguide config get regulationStrategy.probe.timeoutMs
  pguide config add-objective health .\objective --scope user
```

## machine-field-comparison

下表为实际 JSON 的字段投影，不是完整原始输出；只选取与对应文字摘要缺失信息有关的字段。

| 场景 | JSON 字段投影 |
| --- | --- |
| probe-actionable-gap | `{"status":200,"current":{"objectiveId":"git+file:///<FIXTURE>/repo#objective/","levelId":"initial"},"problems":[{"kind":"internal","ref":{"objectiveId":"git+file:///<FIXTURE>/repo#objective/","levelId":"initial","checkId":"ready","problemId":"not-ready"},"parameters":{}}]}` |
| probe-terminal | `{"status":200,"current":{"objectiveId":"git+file:///<FIXTURE>/repo#objective/","levelId":"terminal"},"problems":[]}` |
| regulate-stalled | `{"schemaVersion":2,"status":"exhausted","stopReason":"exhausted","iterations":1,"stalledRuns":1,"attemptStatus":"exhausted"}` |
| supervise-plan | `{"schemaVersion":3,"status":"planned","queue":[{"id":"audit","targetLevel":"terminal"}],"eventTypes":[]}` |
| supervise-execute | `{"schemaVersion":3,"status":"executed","queue":[{"id":"audit","targetLevel":"terminal"}],"eventTypes":[]}` |
| diagnose-agent | `{"agent":{"name":"fixture","source":{"scope":"project","path":"<FIXTURE>\\repo\\.pguide\\agents.yaml"},"type":"acp","initialize":{"protocolVersion":1,"agentCapabilities":{"loadSession":true}}}}` |
| diagnose-conflict | `{"conflicts":{"probe":["<FIXTURE>\\commands\\pguide-probe.cmd","<FIXTURE>\\commands-conflict\\pguide-probe.cmd"]}}` |
| supervise-observation-failure | `{"schemaVersion":1,"status":"internal-error","error":"Observation failed for audit: Synthetic check invocation failed"}` |
