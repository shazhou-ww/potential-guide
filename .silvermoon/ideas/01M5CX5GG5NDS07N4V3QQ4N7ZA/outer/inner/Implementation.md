# Implementation

实施使用独立资源，不改变主配置的 YAML 语法或无关持久化输出版本。
公共 schema 源码、离线包内副本及管理入口在本仓库交付；公共站点可取得和独立安装后的
真实消费证据仍属于 Deployment，不由这里的源码或测试结果替代。

## Steps

### I-S01: 抽离资源契约和加载边界

`schemas/agents/v1.json` 采用 Draft2020-12/$defs；`@potential-guide/cli-core` 随包导出
`schemas/agents/v1.json`，`parseAgents` 离线校验 canonical ACP/AHP profiles 并复用秘密检查，
拒绝无顶层 type 的旧 ACP profile，只有显式迁移负责规范化旧定义。未知 URI 不联网下载。
构建脚本从唯一公共源码复制到 dist，Turbo 输入包含该源码与脚本。

`PguideConfig` 不再包含 agents，`loadConfig` 不读取或校验资源；
profile 消费者显式调用 `loadAgents(cwd)`，单独取得有效 profile、来源作用域和路径。
非法用户或项目资源不能阻断普通 config、只消费 Objective 的操作或无 Agent 选择的诊断；
真实 profile 消费者仍明确失败，不吞掉错误。
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
包内 schema 与仓库公开源码按字节比较，Ajv2020 验证 schema 并与离线 parser 对照 canonical
结构，证明新资源拒绝无 type 的旧 ACP，而显式迁移能产生合法 canonical 文件。
`packages/pguide/test/cli.test.ts`
验证主配置拒绝内嵌格式时仍可经默认分发执行显式迁移，以及命令发现、帮助和补全。

### I-AC02: 消费与作用域一致

core、治理/继续、AHP CLI、监督、声明输入、setup 与 self-check 的测试样例均使用
独立资源，实际执行仍覆盖 ACP/AHP、规划、动态资源刷新和权限撤销。
直接执行的 manager/CLI/setup 联合测试为 55 项：54 通过、1 项平台跳过、0 失败，
不是 Turbo 缓存重放；另一次 core/manager 定向执行为 20/20 通过。
评审后的新鲜定向测试为 manager 9/9、分发及资源隔离回归 2/2：
非法用户/项目资源不阻断 config show/path/get/set、Objective 静态验证和普通 diagnose，
但 agents validate、diagnose agent 和 regulate 都明确失败。

### I-AC03: 升级不损坏或泄密

迁移测试验证精确备份、未知主配置字段及注释保留、同名目的地冲突时两个原文件不变、
拒绝跨作用域迁移；非法 profile、草稿和并发变更不覆盖已有文件。凭据只保留环境引用，
CLI 输出不包含测试注入的秘密。执行 `pnpm check`、独立包 `pnpm pack:check`
及 Silvermoon 候选检查；本分支补齐 package tag 与 manual dispatch choice，
registry 测试逐项检查两条发布入口。公共站点部署仍由父协调者验证，不得在本分支宣称已部署。

本分支最新直接 manager 测试 9/9 通过，包含 Windows 只读来源导致真实替换失败后的
目的地回滚和精确备份检查。最终 `pnpm check` 返回 0，内含 `pnpm pack:check`：
16 个包，protocol/main/pilot/
regulation/supervision/objectives/config/agents/combined 九种隔离消费场景。
layers、format、lint、typecheck 通过，`silvermoon check --worktree --audience agent`
返回 0。最终完整检查的 40 个 workspace 测试任务全部通过，其中 14 个使用缓存；
pguide 87 项中 85 通过、2 项平台跳过，脚本测试 37/37 通过。
首次评审后全量运行曾触发监督测试既有 8 秒反馈 deadline，单独重跑该测试通过；
保留原阈值后再次完整运行通过，没有将失败归为部署证据或静默忽略。

Ubuntu CI run `39462606984`、job `118765903264` 在 Node 22.13.0 暴露了测试生命周期问题：
两个嵌套异步测试没有被父测试等待，结果为 `cancelledByParent`，不是 Agent runtime 故障。
在快进到 `origin/main` 的 `f3d80b3e2d1a1672f721998cb6447a5032270bc3` 后，
Windows Node 22.13.0 的修复前复现为 6 通过、1 失败、2 取消；
同一代码在 Node 24.12.0 虽然 9/9 通过，但该结果不能证明父子测试等待关系正确。

修复只将父测试改为显式接收 TestContext，并依次 `await t.test(...)` 等待 editor drafts
和 packaged schema 两个子测试，使其完成后才执行父测试的后续断言与 finally 清理；
没有生产代码、超时、跳过或断言豁免变更。最终文件在 Windows Node 22.13.0 和 24.12.0
分别直接运行 `node --import tsx --test packages\pguide-agents\test\agents.test.ts`，
均为 9 通过、0 失败、0 取消、0 跳过，不是 Turbo 缓存结果。
该修复的 `pnpm check` 返回 0：40 个 workspace 测试任务通过（30 个缓存），
pguide 88 项中 86 通过、2 项既有平台跳过，脚本测试 39/39 通过，
16 个包的九种隔离消费场景通过。
此更新改变 Inner revision；真实 Ubuntu CI 复验及对应接受刷新由父协调者负责，
本修复没有追加或改写任何生命周期事件，也没有宣称新 CI 已通过。

父协调者随后使用 TypeScript AST 检查任务改动文件，发现
`packages/pguide/test/ahp-cli.test.ts` 的 AHP 闭环测试仍嵌套调用全局 test。
在快进到 `37d50e3568a5eace030237000e80a730544a024f` 后，仅将该父测试接收的
TestContext 显式传入，并把已有的 `await test(...)` 改为 `await t.test(...)`，
明确 supervisor planning/process-worker 子测试的所有者与完成顺序；
没有改变生产代码、既有超时、跳过或断言。该文件的 AST 复核为嵌套全局 test 调用 0 个、
显式等待的父上下文子测试 1 个。
Windows Node 22.13.0 和 24.12.0 分别直接执行
`node --import tsx --test --test-concurrency=1 packages\pguide\test\ahp-cli.test.ts`，
两次均为 10 通过、0 失败、0 取消、0 跳过，不是缓存重放。
`pnpm check` 返回 0：40 个 workspace 测试任务通过（32 个缓存），
pguide 88 项中 86 通过、2 项既有平台跳过，脚本测试 39/39，
16 个包的九种隔离消费场景通过。此补充证据同样需要父协调者重新确认对应 Inner revision，
不替代真实 CI 复验，也没有改动其他 Agent 负责的 monorepo 测试或生命周期事件。
