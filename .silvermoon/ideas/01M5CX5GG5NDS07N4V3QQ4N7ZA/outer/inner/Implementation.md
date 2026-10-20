# Implementation

实施使用独立资源，不改变主配置的 YAML 语法或无关持久化输出版本。
公共 schema 源码、离线包内副本及管理入口在本仓库交付；公共站点可取得和独立安装后的
真实消费证据仍属于 Deployment，不由这里的源码或测试结果替代。

## Steps

### I-S01: 抽离资源契约和加载边界

`schemas/agents/v1.json` 定义公开文件；`@potential-guide/cli-core` 随包导出
`schemas/agents/v1.json`，`parseAgents` 离线校验并复用既有 ACP/AHP profile 规范化与秘密检查，
未知 URI 不联网下载。构建脚本从唯一公共源码复制到 dist，Turbo 输入包含该源码与脚本。

`PguideConfig` 不再包含 agents，`LoadedConfig.agents` 单独返回有效 profile、来源作用域和路径。
用户资源在原用户配置目录；项目资源优先在按原规则发现的项目主配置目录。
没有项目主配置时才回退到最近的项目 agents.yaml，尚无资源时定位到 cwd 的 .pguide。
项目同名 profile 整体覆盖用户 profile，不深合并；显式 `--config` 仍只改变普通配置，
既不创造第三个资源作用域，也不搬移授权边界。

### I-S02: 统一管理与执行消费

Tools 层新增 `@potential-guide/pguide-agents`，按既有命令包方式提供
list/show/set/remove/edit/validate/path/migrate，纳入 pguide 的生产依赖、分发、帮助、
补全及独立包消费检查。读取展示所选作用域和完整来源，写入必须明确 user/project。

治理、监督的 planner/resource 和运行时刷新、诊断都读取同一资源加载结果；
setup/self-check 通过 agents show 取 profile，隔离 sanity fixture 使用项目 agents.yaml，
相关提交 runtime 由既有生成脚本更新。ACP/AHP 会话语义、凭据环境引用和权限 ceiling
保持原边界。旧主配置的 agents 一律明确拒绝；旧 config Agent 命令返回新入口和迁移指导，
不继续维护兼容读取。

### I-S03: 验证写入和升级

资源写入使用独占协作锁、完整校验、原子替换及预期内容检查；拒绝符号链接文件、
重复 YAML 键、非法已有资源、重复或未知选项和并发编辑。编辑器只修改私有草稿。
迁移锁定同一作用域的两个端点，先校验全部 profiles 和目的地冲突，再保存原始文件的
私有精确备份；通过 YAML 文档删除 agents 节点，保留其余字段、未知值和注释。
第二端点写入失败且原来源未变时回滚目的地；若来源已经提交或被并发写者修改，
保留已校验的目的地以避免丢失 profiles。突然进程终止后的恢复应检查两个端点与保留的备份，
不声称跨文件分布式事务。文档说明恢复和凭据边界。

## Acceptance criteria

### I-AC01: 独立管理可用

`packages/pguide-agents/test/agents.test.ts` 覆盖离线 schema/协议、两种资源作用域、
whole-profile 覆盖和来源、所有约定命令、编辑校验、未知/重复参数、锁及并发失败；
包内 schema 与仓库公开源码按字节比较。`packages/pguide/test/cli.test.ts`
验证主配置拒绝内嵌格式时仍可经默认分发执行显式迁移，以及命令发现、帮助和补全。

### I-AC02: 消费与作用域一致

core、治理/继续、AHP CLI、监督、声明输入、setup 与 self-check 的测试样例均使用
独立资源，实际执行仍覆盖 ACP/AHP、规划、动态资源刷新和权限撤销。
直接执行的 manager/CLI/setup 联合测试为 55 项：54 通过、1 项平台跳过、0 失败，
不是 Turbo 缓存重放；另一次 core/manager 定向执行为 20/20 通过。

### I-AC03: 升级不损坏或泄密

迁移测试验证精确备份、未知主配置字段及注释保留、同名目的地冲突时两个原文件不变、
拒绝跨作用域迁移；非法 profile、草稿和并发变更不覆盖已有文件。凭据只保留环境引用，
CLI 输出不包含测试注入的秘密。执行 `pnpm check`、独立包 `pnpm pack:check`
及 Silvermoon 候选检查；完整集成后的工作流发布触发器与公共站点部署由父协调者验证，
不得在本分支宣称已部署。

本分支最新直接 manager 测试 8/8 通过，包含 Windows 只读来源导致真实替换失败后的
目的地回滚和精确备份检查。`pnpm pack:check` 通过：16 个包，protocol/main/pilot/
regulation/supervision/objectives/config/agents/combined 九种隔离消费场景。
layers、format、lint、typecheck 通过，`silvermoon check --worktree --audience agent`
返回 0。完整 `pnpm check` 的 40 个 workspace 任务全部通过，其中 14 个使用缓存；
脚本测试 37 项中 36 项通过，唯一失败为父协调者保留所有权的
`.github/workflows/publish-npm.yaml` 缺少 `pguide-agents-v*` 发布触发器。
本分支依照分工没有修改工作流；I-AC03 在父协调者集成该触发器并重跑完整检查前保持未完成。
