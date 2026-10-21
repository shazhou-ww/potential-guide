# CLI 实测覆盖矩阵

本表由 2026-10-21 的真实子进程记录生成，不是预期结果。完整方法、排除项及限制见[审计说明](./output-audit.md)；问题解释见[问题清单](./output-findings.md)。

纳入 **421 次调用、169 个场景**；原始 431 次调用中，排除 10 次 fixture 调试或被后续 --format 覆盖的无效测试。未发生超时/强制终止。

D = 默认，M = 显式 Markdown，J = 显式 JSON，P = 固定协议输出。数字为进程退出码，不等于 Objective 达成状态。JSON 一栏为顶层键；`无输出` 是实测缺陷，不是漏采。所有非迁移、非协议调用都传入隔离的 `--cwd <FIXTURE>\repo --config <FIXTURE>\config.json`，表中省略这两个共同选项。

| 场景 | 实际命令（默认或协议样本） | D | M | J | P | JSON 顶层键 |
| --- | --- | --- | --- | --- | --- | --- |
| help-probe | `pguide-probe --help` | 0 | 0 | 0 | — | schemaVersion, command, options |
| version-probe | `pguide-probe --version` | 0 | 0 | 0 | — | schemaVersion, command, version |
| metadata-probe | `pguide-probe --pguide-command-metadata` | 0 | — | — | — | — |
| invalid-probe | `pguide-probe unknown` | 2 | 2 | 2 | — | schemaVersion, status, error |
| help-scaffold | `pguide-scaffold --help` | 0 | 0 | 0 | — | schemaVersion, command, types |
| version-scaffold | `pguide-scaffold --version` | 0 | 0 | 0 | — | schemaVersion, command, version |
| metadata-scaffold | `pguide-scaffold --pguide-command-metadata` | 0 | — | — | — | — |
| invalid-scaffold | `pguide-scaffold unknown` | 2 | 2 | 2 | — | schemaVersion, status, error |
| help-validate | `pguide-validate --help` | 0 | 0 | 0 | — | schemaVersion, command, types |
| version-validate | `pguide-validate --version` | 0 | 0 | 0 | — | schemaVersion, command, version |
| metadata-validate | `pguide-validate --pguide-command-metadata` | 0 | — | — | — | — |
| invalid-validate | `pguide-validate unknown` | 2 | 2 | 2 | — | schemaVersion, status, error |
| help-regulate | `pguide-regulate --help` | 0 | 0 | 0 | — | schemaVersion, command |
| version-regulate | `pguide-regulate --version` | 0 | 0 | 0 | — | schemaVersion, command, version |
| metadata-regulate | `pguide-regulate --pguide-command-metadata` | 0 | — | — | — | — |
| invalid-regulate | `pguide-regulate unknown` | 2 | 2 | 2 | — | schemaVersion, status, error |
| help-continue | `pguide-continue --help` | 0 | 0 | 0 | — | schemaVersion, command |
| version-continue | `pguide-continue --version` | 0 | 0 | 0 | — | schemaVersion, command, version |
| metadata-continue | `pguide-continue --pguide-command-metadata` | 0 | — | — | — | — |
| invalid-continue | `pguide-continue unknown` | 2 | 2 | 2 | — | schemaVersion, status, error |
| help-supervise | `pguide-supervise --help` | 0 | 0 | 0 | — | schemaVersion, command |
| version-supervise | `pguide-supervise --version` | 0 | 0 | 0 | — | schemaVersion, command, version |
| metadata-supervise | `pguide-supervise --pguide-command-metadata` | 0 | — | — | — | — |
| invalid-supervise | `pguide-supervise unknown` | 2 | 2 | 2 | — | schemaVersion, status, error |
| help-objectives | `pguide-objectives --help` | 0 | 0 | 0 | — | schemaVersion, command |
| version-objectives | `pguide-objectives --version` | 0 | 0 | 0 | — | schemaVersion, command, version |
| metadata-objectives | `pguide-objectives --pguide-command-metadata` | 0 | — | — | — | — |
| invalid-objectives | `pguide-objectives unknown` | 2 | 2 | 2 | — | schemaVersion, status, error |
| help-config | `pguide-config --help` | 0 | 0 | 0 | — | schemaVersion, command, subcommands, configurationSchemaVersion, regulationStrategyDefaults |
| version-config | `pguide-config --version` | 0 | 0 | 0 | — | schemaVersion, command, version |
| metadata-config | `pguide-config --pguide-command-metadata` | 0 | — | — | — | — |
| invalid-config | `pguide-config unknown` | 2 | 2 | 2 | — | schemaVersion, status, error |
| help-agents | `pguide-agents --help` | 0 | 0 | 0 | — | schemaVersion, command, subcommands, resourceSchema |
| version-agents | `pguide-agents --version` | 0 | 0 | 0 | — | schemaVersion, command, version |
| metadata-agents | `pguide-agents --pguide-command-metadata` | 0 | — | — | — | — |
| invalid-agents | `pguide-agents unknown` | 2 | 2 | 2 | — | schemaVersion, status, error |
| help-pguide | `pguide --help` | 0 | 0 | 0 | — | schemaVersion, name, version, commands, conflicts |
| version-pguide | `pguide --version` | 0 | 0 | 0 | — | schemaVersion, name, version |
| invalid-pguide | `pguide unknown` | 2 | 2 | 2 | — | schemaVersion, status, error |
| scaffold-create | `pguide-scaffold pilot <FIXTURE>\repo\objective --check ready --problem not-ready` | 0 | 0 | 0 | — | schemaVersion, status, directory, manifest |
| scaffold-exists | `pguide-scaffold pilot <FIXTURE>\repo\objective` | 2 | 2 | 2 | — | schemaVersion, status, error |
| validate-valid | `pguide-validate pilot <FIXTURE>\repo\objective` | 0 | 0 | 0 | — | schemaVersion, status, objectiveId |
| validate-missing | `pguide-validate pilot <FIXTURE>\absent` | 2 | 2 | 2 | — | schemaVersion, status, error |
| objectives-empty | `pguide-objectives list` | 0 | 0 | 0 | — | schemaVersion, objectives, legacyAliases |
| objectives-one | `pguide-objectives list` | 0 | 0 | 0 | — | schemaVersion, objectives, legacyAliases |
| objectives-show | `pguide-objectives show sample` | 0 | 0 | 0 | — | schemaVersion, objectives, legacyAliases |
| objectives-ambiguous | `pguide-objectives show sample` | 2 | 2 | 2 | — | schemaVersion, status, error |
| objectives-show-scoped | `pguide-objectives show sample --scope user` | 0 | 0 | 0 | — | schemaVersion, objectives, legacyAliases |
| objectives-set | `pguide-objectives set sample --scope directory --from <FIXTURE>\declaration.json` | 0 | 0 | 0 | — | schemaVersion, status, file, name |
| objectives-remove | `pguide-objectives remove sample --scope directory` | 0 | 0 | 0 | — | schemaVersion, status, file, name |
| objectives-migrate | `pguide-objectives migrate sample --scope directory --from <FIXTURE>\declaration.json --legacy-config <FIXTURE>\legacy-config.json` | 0 | 0 | 0 | — | schemaVersion, status, file, name |
| agents-empty-list | `pguide-agents list` | 0 | 0 | 0 | — | schemaVersion, status, agents, paths |
| agents-empty-path | `pguide-agents path` | 0 | 0 | 0 | — | schemaVersion, paths |
| agents-empty-validate | `pguide-agents validate` | 0 | 0 | 0 | — | schemaVersion, status, agents, paths |
| agents-list | `pguide-agents list` | 0 | 0 | 0 | — | schemaVersion, status, agents, paths |
| agents-show | `pguide-agents show fixture` | 0 | 0 | 0 | — | schemaVersion, name, profile, source |
| agents-path | `pguide-agents path` | 0 | 0 | 0 | — | schemaVersion, paths |
| agents-validate | `pguide-agents validate` | 0 | 0 | 0 | — | schemaVersion, status, agents, paths |
| agents-set | `pguide-agents set fixture --scope project --from <FIXTURE>\profile.json` | 0 | 0 | 0 | — | schemaVersion, status, path, scope |
| agents-remove | `pguide-agents remove fixture --scope project` | 0 | 0 | 0 | — | schemaVersion, status, path, scope |
| agents-edit | `pguide-agents edit --scope project` | 0 | 0 | 0 | — | schemaVersion, status, path, scope |
| agents-migrate | `pguide-agents migrate --scope project --legacy-config <FIXTURE>\repo\.pguide\config.yaml` | 0 | 0 | 0 | — | schemaVersion, source, destination, backup, names |
| config-show | `pguide-config show` | 0 | 0 | 0 | — | schemaVersion, config, sources |
| config-path | `pguide-config path` | 0 | 0 | 0 | — | schemaVersion, paths |
| config-validate | `pguide-config validate` | 0 | 0 | 0 | — | schemaVersion, status, paths |
| config-list-objectives | `pguide-config list-objectives` | 0 | 0 | 0 | — | schemaVersion, objectives |
| config-get-scalar | `pguide-config get defaultAgent` | 0 | 0 | 0 | — | schemaVersion, key, value |
| config-get-object | `pguide-config get regulationStrategy` | 0 | 0 | 0 | — | schemaVersion, key, value |
| config-get-secret | `pguide-config get apiToken` | 2 | 2 | 2 | — | schemaVersion, status, error |
| config-set | `pguide-config set defaultAgent fixture --scope explicit` | 0 | 0 | 0 | — | schemaVersion, status, path |
| config-unset | `pguide-config unset defaultAgent --scope explicit` | 0 | 0 | 0 | — | schemaVersion, status, path |
| config-edit | `pguide-config edit --scope explicit` | 0 | 0 | 0 | — | 无输出/非 JSON |
| config-list-legacy | `pguide-config list-objectives` | 0 | 0 | 0 | — | schemaVersion, objectives |
| config-remove-objective | `pguide-config remove-objective old --scope explicit` | 0 | 0 | 0 | — | schemaVersion, status, path |
| config-retired-list-agents | `pguide-config list-agents` | 2 | — | — | — | — |
| config-retired-show-agent | `pguide-config show-agent` | 2 | — | — | — | — |
| config-retired-add-agent | `pguide-config add-agent` | 2 | — | — | — | — |
| config-retired-update-agent | `pguide-config update-agent` | 2 | — | — | — | — |
| config-retired-remove-agent | `pguide-config remove-agent` | 2 | — | — | — | — |
| config-retired-add-objective | `pguide-config add-objective` | 2 | — | — | — | — |
| config-retired-update-objective | `pguide-config update-objective` | 2 | — | — | — | — |
| probe-gap | `pguide-probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --no-reports` | 0 | 0 | 0 | — | status, message, payload |
| probe-invalid-input | `pguide-probe --pilot git+file:///<FIXTURE>/repo#objective/ --no-reports` | 2 | 2 | 2 | — | schemaVersion, status, error |
| regulate-stalled | `pguide-regulate --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --target terminal --agent fixture` | 5 | 5 | 5 | — | schemaVersion, regulationId, status, outcome, attempts, recovery |
| continue-stalled | `pguide-continue <UUID>` | 5 | 5 | 5 | — | schemaVersion, regulationId, status, outcome, attempts, recovery |
| continue-missing | `pguide-continue <UUID>` | 6 | 6 | 6 | — | schemaVersion, status, error |
| supervise-plan | `pguide-supervise --portfolio-file <FIXTURE>\portfolio.json --planner fixture` | 0 | 0 | 0 | — | schemaVersion, status, observations, queue, events |
| supervise-execute | `pguide-supervise --portfolio-file <FIXTURE>\portfolio.json --planner fixture --execute --duration-ms 300` | 0 | 0 | 0 | — | schemaVersion, status, observations, queue, events |
| diagnose | `pguide diagnose` | 0 | 0 | 0 | — | schemaVersion, status, node, config, commands, conflicts |
| diagnose-agent | `pguide diagnose agent fixture` | 0 | 0 | 0 | — | schemaVersion, status, node, config, commands, conflicts, agent |
| complete-bash | `pguide complete --shell bash` | 0 | 0 | 0 | — | schemaVersion, shell, script |
| complete-zsh | `pguide complete --shell zsh` | 0 | 0 | 0 | — | schemaVersion, shell, script |
| complete-fish | `pguide complete --shell fish` | 0 | 0 | 0 | — | schemaVersion, shell, script |
| complete-powershell | `pguide complete --shell powershell` | 0 | 0 | 0 | — | schemaVersion, shell, script |
| dispatch-objectives | `pguide objectives list` | 0 | 0 | 0 | — | schemaVersion, objectives, legacyAliases |
| format-invalid | `pguide-objectives list --format bogus` | 2 | — | — | — | — |
| subhelp-config | `pguide-config show --help` | 0 | 0 | 0 | — | schemaVersion, command, subcommands, configurationSchemaVersion, regulationStrategyDefaults |
| subhelp-agents | `pguide-agents show --help` | 0 | 0 | 0 | — | schemaVersion, command, subcommands, resourceSchema |
| subhelp-objectives | `pguide-objectives show --help` | 0 | 0 | 0 | — | schemaVersion, command |
| subhelp-probe | `pguide-probe --pilot --help` | 0 | 0 | 0 | — | schemaVersion, command, options |
| migration-help | `objective-contract-migrate --help` | 0 | — | — | — | — |
| migration-help-json | `objective-contract-migrate --help --format json` | 0 | — | — | — | — |
| migration-invalid | `objective-contract-migrate` | 1 | — | — | — | — |
| dispatch-help-probe | `pguide probe --help` | 0 | 0 | 0 | — | schemaVersion, command, options |
| dispatch-help-regulate | `pguide regulate --help` | 0 | 0 | 0 | — | schemaVersion, command |
| dispatch-help-continue | `pguide continue --help` | 0 | 0 | 0 | — | schemaVersion, command |
| dispatch-help-supervise | `pguide supervise --help` | 0 | 0 | 0 | — | schemaVersion, command |
| dispatch-help-scaffold | `pguide scaffold --help` | 0 | 0 | 0 | — | schemaVersion, command, types |
| dispatch-help-validate | `pguide validate --help` | 0 | 0 | 0 | — | schemaVersion, command, types |
| dispatch-help-agents | `pguide agents --help` | 0 | 0 | 0 | — | schemaVersion, command, subcommands, resourceSchema |
| dispatch-help-objectives | `pguide objectives --help` | 0 | 0 | 0 | — | schemaVersion, command |
| dispatch-help-config | `pguide config --help` | 0 | 0 | 0 | — | schemaVersion, command, subcommands, configurationSchemaVersion, regulationStrategyDefaults |
| config-missing-key | `pguide-config get nonexistent` | 2 | 2 | 2 | — | schemaVersion, status, error |
| agents-unknown-profile | `pguide-agents show unknown` | 2 | 2 | 2 | — | schemaVersion, status, error |
| objectives-unknown-name | `pguide-objectives show unknown` | 2 | 2 | 2 | — | schemaVersion, status, error |
| validate-unknown-option | `pguide-validate pilot <FIXTURE>\repo\objective --bogus` | 0 | 0 | 0 | — | schemaVersion, status, objectiveId |
| objectives-missing-scope | `pguide-objectives remove sample` | 2 | 2 | 2 | — | schemaVersion, status, error |
| config-help-retired | `pguide-config add-agent --help` | 0 | 0 | 0 | — | schemaVersion, command, subcommands, configurationSchemaVersion, regulationStrategyDefaults |
| probe-language-zh | `pguide-probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --language zh-CN --no-reports` | 2 | 2 | 2 | — | schemaVersion, status, error |
| probe-report | `pguide-probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --report <FIXTURE>\observation-report.json --no-reports` | 0 | 0 | 0 | — | status, message, payload |
| probe-terminal | `pguide-probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --no-reports` | 0 | 0 | 0 | — | status, message, payload |
| regulate-terminal | `pguide-regulate --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --target terminal --agent fixture` | 0 | 0 | 0 | — | schemaVersion, regulationId, status, outcome, attempts, recovery |
| continue-terminal | `pguide-continue <UUID>` | 0 | 0 | 0 | — | schemaVersion, regulationId, status, outcome, attempts, recovery |
| probe-invocation-failure | `pguide-probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --no-reports` | 6 | 6 | 6 | — | status, payload, message |
| regulate-invocation-failure | `pguide-regulate --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --target terminal --agent fixture` | 6 | 6 | 6 | — | schemaVersion, status, error |
| supervise-observation-failure | `pguide-supervise --portfolio-file <FIXTURE>\portfolio.json --planner fixture` | 70 | 70 | 70 | — | schemaVersion, status, error |
| protocol-objective-devbox-health-identity | `node <WORKTREE>\packages\objective-devbox-health\checks\identity\run.cjs --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-objective-devbox-health-order | `node <WORKTREE>\packages\objective-devbox-health\checks\order\run.cjs --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-objective-devbox-health-sustainability | `node <WORKTREE>\packages\objective-devbox-health\checks\sustainability\run.cjs --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-objective-devbox-health-system | `node <WORKTREE>\packages\objective-devbox-health\checks\system\run.cjs --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-objective-devbox-health-toolchains | `node <WORKTREE>\packages\objective-devbox-health\checks\toolchains\run.cjs --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-objective-pguide-setup-configuration | `node <WORKTREE>\packages\objective-pguide-setup\checks\configuration\run.cjs --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-objective-pguide-setup-installation | `node <WORKTREE>\packages\objective-pguide-setup\checks\installation\run.cjs --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-objective-pguide-setup-sanity | `node <WORKTREE>\packages\objective-pguide-setup\checks\sanity\run.cjs --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-objective-pguide-self-check-configuration | `node <WORKTREE>\packages\objective-pguide-self-check\checks\configuration\run.cjs --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-objective-pguide-self-check-installation | `node <WORKTREE>\packages\objective-pguide-self-check\checks\installation\run.cjs --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-objective-pguide-self-check-sanity | `node <WORKTREE>\packages\objective-pguide-self-check\checks\sanity\run.cjs --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-objective-monorepo-standard-deliveries | `node <WORKTREE>\packages\objective-monorepo-standard\checks\deliveries\run.cjs --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-objective-monorepo-standard-structure | `node <WORKTREE>\packages\objective-monorepo-standard\checks\structure\run.cjs --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-runtime-objective-devbox-health | `node <WORKTREE>\packages\objective-devbox-health\runtime\health-check.mjs system --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-runtime-objective-pguide-setup | `node <WORKTREE>\packages\objective-pguide-setup\runtime\setup-check.mjs installation --no-reports` | — | — | — | 0 | status, payload, message |
| protocol-runtime-objective-pguide-self-check | `node <WORKTREE>\packages\objective-pguide-self-check\runtime\setup-check.mjs installation --no-reports` | — | — | — | 0 | status, payload, message |
| monorepo-wrapper-usage | `node <WORKTREE>\packages\objective-monorepo-standard\check.mjs` | 2 | — | — | — | — |
| migration-manifest-valid | `objective-contract-migrate --format manifest --input <FIXTURE>\legacy-manifest-valid.json --output <FIXTURE>\migrated-manifest.json` | 0 | — | — | — | — |
| migration-manifest-existing | `objective-contract-migrate --format manifest --input <FIXTURE>\legacy-manifest-valid.json --output <FIXTURE>\migrated-manifest.json` | 1 | — | — | — | — |
| dispatch-normal-config | `pguide config show` | 0 | 0 | 0 | — | schemaVersion, config, sources |
| dispatch-normal-agents | `pguide agents list` | 0 | 0 | 0 | — | schemaVersion, status, agents, paths |
| dispatch-normal-objectives | `pguide objectives list` | 0 | 0 | 0 | — | schemaVersion, objectives, legacyAliases |
| dispatch-normal-probe | `pguide probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --no-reports` | 0 | 0 | 0 | — | status, message, payload |
| dispatch-normal-regulate | `pguide regulate --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --target terminal --agent fixture` | 5 | 5 | 5 | — | schemaVersion, regulationId, status, outcome, attempts, recovery |
| dispatch-normal-continue | `pguide continue <UUID>` | 5 | 5 | 5 | — | schemaVersion, regulationId, status, outcome, attempts, recovery |
| dispatch-normal-supervise | `pguide supervise --portfolio-file <FIXTURE>\portfolio.json --planner fixture` | 0 | 0 | 0 | — | schemaVersion, status, observations, queue, events |
| dispatch-normal-validate | `pguide validate pilot <FIXTURE>\repo\objective` | 0 | 0 | 0 | — | schemaVersion, status, objectiveId |
| dispatch-normal-scaffold | `pguide scaffold pilot <FIXTURE>\top-scaffold-default` | 0 | 0 | 0 | — | schemaVersion, status, directory, manifest |
| diagnose-configured | `pguide diagnose` | 0 | 0 | 0 | — | schemaVersion, status, node, config, commands, conflicts |
| diagnose-agent-configured | `pguide diagnose agent fixture` | 0 | 0 | 0 | — | schemaVersion, status, node, config, commands, conflicts, agent |
| diagnose-conflict | `pguide diagnose` | 2 | 2 | 2 | — | schemaVersion, status, node, config, commands, conflicts |
| help-conflict | `pguide --help` | 0 | 0 | 0 | — | schemaVersion, name, version, commands, conflicts |
| dispatch-conflict | `pguide probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json` | 2 | 2 | 2 | — | schemaVersion, status, error |
| color-always | `pguide diagnose --color always` | 0 | 0 | 0 | — | schemaVersion, status, node, config, commands, conflicts |
| color-never | `pguide diagnose --color never` | 0 | 0 | 0 | — | schemaVersion, status, node, config, commands, conflicts |
| log-debug | `pguide diagnose --log-level debug` | 0 | 0 | 0 | — | schemaVersion, status, node, config, commands, conflicts |
| migration-declarations-success | `objective-contract-migrate --format declarations --input <FIXTURE>\legacy-declarations-corrected.json --output <FIXTURE>\migrated-declarations.json` | 0 | — | — | — | — |
| migration-declarations-overwrite | `objective-contract-migrate --format declarations --input <FIXTURE>\legacy-declarations-corrected.json --output <FIXTURE>\migrated-declarations.json` | 1 | — | — | — | — |
| migration-portfolio-success | `objective-contract-migrate --format portfolio --input <FIXTURE>\legacy-portfolio-corrected.json --output <FIXTURE>\migrated-portfolio.json` | 0 | — | — | — | — |
| migration-portfolio-overwrite | `objective-contract-migrate --format portfolio --input <FIXTURE>\legacy-portfolio-corrected.json --output <FIXTURE>\migrated-portfolio.json` | 1 | — | — | — | — |
| probe-actionable-gap | `pguide-probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --no-reports` | 0 | 0 | 0 | — | status, message, payload |
| probe-schema-guidance | `pguide-probe --pilot git+file:///<FIXTURE>/repo#objective/ --subject-file <FIXTURE>\subject.json --no-reports` | 2 | 2 | 2 | — | schemaVersion, status, error |
| objectives-many-legacy | `pguide-objectives list` | 0 | 0 | 0 | — | schemaVersion, objectives, legacyAliases |
