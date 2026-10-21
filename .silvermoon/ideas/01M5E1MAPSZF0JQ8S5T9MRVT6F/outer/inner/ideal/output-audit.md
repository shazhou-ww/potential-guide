# 全部 CLI 输出规范化审计

## 目标与阅读入口

本 idea 不再局限于 objectives 的 JSON 展示缺陷，而是统一梳理仓库拥有的全部 CLI 的格式、信息层级、内容、帮助、错误、写入回执和机器消费边界。本阶段只审计与定义方向，不修改实现，也不把问题整理等同于问题已经修复。

- [问题清单](./output-findings.md)：24 个问题逐项列出具体命令、实测输出、影响和期望。
- [实际输出样例](./output-examples.md)：归一化 stdout/stderr、退出码，以及必要的 JSON 字段对照。
- [实测覆盖矩阵](./output-coverage.md)：421 次有效调用、169 个场景的模式和退出码，含 108 次主入口调用。
- [输出规范方向](./output-conventions.md)：统一规则、合理例外和兼容性约束。

## 本轮实际执行了什么

2026-10-21，Windows，Node v24.11.1，当前工作树构建的 `pguide 0.4.0-rc.0`。先合并当时 primary 的并发文档历史，审计基线为 `d248a134983a93dfb75e0b23fa10ed8660319283`；不是上一轮只运行部分只读命令的结果。

所有调用使用真实子进程，分别捕获 stdout、stderr 和退出码，以管道方式运行，未模拟输出。共执行 431 次；10 次 fixture 调试或测试选项被追加 `--format` 覆盖的无效调用不作为证据，纳入矩阵的 421 次全部正常退出，无超时或强制终止。126 次显式 JSON 调用中，只有 `config edit` 的成功分支没有可解析输出。

| 范围 | 实际覆盖 |
| --- | --- |
| 主入口 `pguide` | 帮助、版本、未知命令、diagnose、diagnose agent、配置目录命令冲突、四类 shell 补全；9 个扩展命令的帮助与正常业务分派 |
| `pguide-objectives` | list/show 的空、单、多条、legacy alias、跨作用域同名、明确 scope、未知名称；set/remove/migrate 成功及参数错误 |
| `pguide-agents` | list/show/path/validate、空资源、未知 profile、set/remove/edit/migrate；编辑器是成功退出的合成脚本 |
| `pguide-config` | show/path/validate/get（标量和对象）、set/unset/edit、legacy Objective 列表与删除、全部 7 个退役子命令；帮助、未知 key/命令和非法配置 |
| `pguide-scaffold`、`pguide-validate` | 创建与目标已存在、有效和缺失 Pilot、未知选项、帮助与版本 |
| `pguide-probe` | 有缺口、terminal、调用失败、非法 JSON、subject schema 失败、显式报告文件、语言不支持；本地 Git fixture，无远程仓库访问 |
| `pguide-regulate`、`pguide-continue` | target-reached、停滞耗尽、继续耗尽、记录不存在、观察调用失败；运行本地无操作 ACP fixture，不使用真实 Agent |
| `pguide-supervise` | 仅计划、有限时执行且无可用执行资源、观察失败；本地 ACP planner 返回合成队列 |
| `objective-contract-migrate` | help、JSON help、缺参数；manifest/declarations/portfolio 三种有效迁移以及拒绝覆盖输出 |
| Objective 检查协议入口 | health 5 个、setup 3 个、self-check 3 个、monorepo 2 个检查入口，加 3 个 runtime 入口，共 16 次固定协议调用；非法 stdin 的 JSON envelope，另检查 monorepo wrapper 用法错误 |

普通 pguide 场景比较默认、显式 `--format markdown`、显式 `--format json`；命令元数据、迁移器和固定协议入口不强行套用不支持的参数。所有业务命令均已在独立入口和主入口实际运行代表性业务场景，不仅执行 `--help`。

## 隔离与复现方式

1. 用专用 fixture 目录提供 `APPDATA`、`XDG_CONFIG_HOME`、`HOME`、`--cwd`、`--config` 和 `stateDirectory`。所有配置、清单、状态、迁移备份、报告及写入只发生在该目录，不读取或修改真实用户配置。
2. 通过真实 `scaffold pilot` 生成 Pilot，在单独的本地 Git 仓库提交，以 `git+file:///...#objective/` 绑定。check 脚本分别返回缺口、成功或合成调用失败；stdin 与 subject 文件都是合成输入。
3. 使用本地 Node ACP fixture 回答 initialize/session/new/session/prompt；planner 返回注册候选队列，普通执行 Agent 不做修改。真实执行了这些 CLI 分支，但不能把 fixture 成功算作真实 Agent 的认证或修复能力验证。
4. 独立入口使用当前工作树的 `dist`。主入口正常业务对照配置专用 `pguide-*.cmd` shim，指向同一组 `dist`；冲突场景加入第二个同名 shim，避免已安装命令影响被比较的业务输出。
5. supporting documents 用 `<FIXTURE>`、`<WORKTREE>`、`<NODE>` 等替换主机路径和随机 ID；保留大小写、标点、空行和输出流。矩阵命令省略共同的隔离参数，样例说明注明真实调用方式。

三个迁移成功用例均独立确认产物存在并能按 JSON 解析：manifest 顶层是 `$schema,subjectSchema,levels,defaultLanguage,languages`，declarations 为 `$schema,objectives`，portfolio 为 `schemaVersion,goals,resources`；随后对相同输出路径再次调用得到退出码 1。`config edit` 使用合法配置及返回 0 的编辑器，确实成功写回，而非仅捕获一个失败或取消场景。

## 结论与优先顺序

默认选项仍然是 Markdown，`objectives list/show` 的展示分支直接序列化 JSON 才是原始问题。全局改默认值不能解决它，也不能解决其他命令内容不足的问题。

先处理影响结果判断的缺陷：原始对象倾倒、空态、静默成功、诊断细节缺失、耗尽/未完成不清晰、错误对象与恢复提示。再统一帮助来源、术语、排版、迁移器体验和显式格式约定。机器输出、固定协议和原文出口必须单独设计兼容边界，不能把所有 JSON/YAML 都视作错误。

## 明确没有覆盖的情况

- 未运行交互 TTY、不同终端宽度、屏幕阅读器、POSIX 系统或交互编辑器 UI；不能声称这些体验已验证。
- 未实际使用外部 Agent、真实认证/权限请求、远程 Git、npm 安装/发布、主机健康检查或真实修复。监督未覆盖所有依赖调度、取消、超时、能力协商和恢复分支。
- 固定协议入口只检查安全的非法输入回执，没有运行主机相关的健康、安装和 sanity 业务。机器 `status` 不同和退出 0 的协议用法不是人类默认 JSON 缺陷。
- 尚未穷举任意第三方扩展、全部 schema 内容、所有配置层级组合、Unicode/ANSI/超长文本或 stderr 来自编辑器/Agent 的情况。已有多行及 Markdown 特殊字符声明样例，但不是完整的排版/转义测试。
- 默认与 Markdown 在固定场景的内容一致；含随机 ID、备份名、运行历史和不同目的路径的调用不能要求字节一致。本轮确认输出形态，不把动态字段差异报告为风格缺陷。

## 源码和回归入口

归因检查涉及[全局选项与输出函数](../../../../../../packages/pguide-cli-core/src/index.ts)、[公共帮助及 launch 入口](../../../../../../packages/pguide-cli-core/src/command-help.ts)、[主入口](../../../../../../packages/pguide/src/bin.ts)、[Objectives](../../../../../../packages/pguide-objectives/src/index.ts)、[Agents](../../../../../../packages/pguide-agents/src/bin.ts)、[配置命令](../../../../../../packages/pguide-config/src/bin.ts)、[配置帮助](../../../../../../packages/pguide-config/src/help.ts)、[Pilot 命令](../../../../../../packages/pguide-pilot/src/commands/pilot.ts)、[调节命令](../../../../../../packages/pguide-regulate/src/commands/regulator.ts)、[监督命令](../../../../../../packages/pguide-supervise/src/commands/supervisor.ts)及[迁移 CLI](../../../../../../packages/pilot-protocol/src/migrate-cli.ts)。

应从[CLI 测试](../../../../../../packages/pguide/test/cli.test.ts)、[Objective 管理测试](../../../../../../packages/pguide/test/objectives.test.ts)、[调节测试](../../../../../../packages/pguide/test/regulator-cli.test.ts)及[监督测试](../../../../../../packages/pguide/test/supervisor-cli.test.ts)扩展人类输出断言。不要仅断言“不是 JSON”，应断言身份、结果、原因、关键来源和下一步；保留既有机器消费者回归。

## 本次文档候选的验证结果

- 场景记录校验通过：421 次有效调用、169 个场景、126 次显式 JSON、108 次主入口、16 次固定协议，无超时；预期成功场景确认到达成功分支，三类迁移产物已读取验证。不是以脚本运行到结尾代替场景结果检查。
- 9 份 Markdown 文档的相对链接/锚点、24 个问题编号、主机路径归一化、无 scaffold 占位以及契约/ledger 稳定 ID 镜像检查通过。
- `silvermoon check --worktree` 通过；提交前另做 staged 检查。本次只维护准备阶段文档，Implementation/Deployment 的执行项仍未勾选，不声称问题已经修复。
- 独立运行相关 CLI 测试，4 项通过：顶层机器帮助/诊断/补全，目录发现，list/show 响应，以及管理和迁移。
- 已执行 `pnpm check`，进程退出 0，但其缓存输出含既有 Supervisor 跨进程依赖测试失败记录（planner 等待 capability feedback 超时），另有 Biome 对缺失 `config` 路径的诊断；因此不能把该退出码表述为“全部检查无异常”。前一轮已独立复现该 Supervisor 失败，本轮未改动其实现，也未把无关修复加入本 idea。
