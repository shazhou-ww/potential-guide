# Implementation

按已验收 idealRevision `54fea1c882ef20d3167387b8b96fd68afe777ac7` 的 [Configuration.md](./ideal/Configuration.md) 和 [Settings.md](./ideal/Settings.md) 实施。主代理已授权生产实施；提交、门限及部署仍由主代理负责。未完成验证前不勾选 ledger。

## Steps

### I-S01: 落实设置存储与 package 描述

按配置规范实现 JSONC、两级作用域、完整 ID 浅合并、整项静态默认和来源展示；接入 package 元数据引用的静态描述及显式注册，不执行扩展获取描述、不新增安装器。核对内置构建与 tarball 的描述交付，复用现有配置入口，避免核心集中枚举扩展类型。

先实现中立设置装配、静态描述验证、两级发现和逐层问题收集；再接入 package 自有描述、显式注册/移除恢复及保留注释的配置编辑。用第三方 fixture 验证不依赖核心类型或扩展执行。

### I-S02: 接入配置消费者与显式迁移

按字段映射接入全部直接和间接消费者：根命令、配置工具、regulate/continue/supervise/probe、独立资源及 setup/self-check 的 config show 协议。保留 quota 共享、拆分三个超时、核对 probe/默认 Agent 的共享及存档/刷新/授权边界；更新读写、帮助、生成产物及手工迁移说明，不新增主配置自动迁移命令，不混回独立 Agent 或 Objective 资源。

统一拒绝各命令与包装入口的 --config 及依赖它的主配置 explicit scope；彻底移除并拒绝 setup/self-check subject.configPath，同步两个 subjectSchema、helper、定点投影/输入迁移说明及生成物。保留该 configuration 阶段至少一份实际 config.jsonc 的门槛，以及其他入口和资源救援/迁移，保持 workingDirectory 发现上下文与隔离 fixture，不扩大权限。旧 YAML 及新旧并存明确失败，换文件名不切断独立资源发现。

### I-S03: 验证配置契约与行为保留

按 Settings.md 的证据链做定向测试，覆盖配置、跨组件消费者、间接运行协议、生成产物及 packed 入口，再运行 pnpm check。先验证存储/注册/编辑，再验证消费者、输入契约及资源边界；生成工具刷新交付产物后强制执行相关新测试，最后记录实际命令、退出码和任何失败解释，不以缓存回放代替新增覆盖。

## Acceptance criteria

### I-AC01: 扩展配置不依赖核心枚举

以独立扩展及 tarball 消费测试证明新增 namespace 和设置无需修改核心全局类型；描述文件随包可定位，根命令和直接 wrapper 一致，归属冲突明确失败，普通配置操作不执行扩展获得描述。同位置/同身份/同 namespace 升级重校验，无逐版本确认；注册损坏/缺失失败而不降格成未知 namespace。

### I-AC02: 覆盖与错误行为符合契约

通过测试证明完整 ID 浅合并、整项默认及来源可见、不补显式对象字段；消费的非法值明确报错，无关 namespace 语义错误隔离，结构错误不可绕过。未知 namespace 写入伴随“未验证”警告，已知及结构错误拒绝写入且原文件不变；JSONC 编辑保留未编辑 key 的注释/顺序，既有资源救援通道保持。

### I-AC03: 旧配置迁移与消费者行为可验证

以手工迁移样例和消费测试验证三个超时默认/显式复制、supervise 共享 quota、probe 不被缩短、continue 权限重读及存档预算、独立资源发现。验证新契约的无 configPath 输入 parse/project/bind/helper 链与旧字段拒绝；自动发现的用户/最近项目均无实际 config.jsonc 时，setup/self-check 报 configuration-missing，不能用默认值代替。目标与 scratch 上下文分离且 fixture 不扩大权限；旧格式/并存/移除入口有明确诊断。定向检查、生成产物检查和 pnpm check 通过，不能以重跑通过掩盖未解释的失败。

## 实施记录

- 中立配置实现位于 `packages/pguide-cli-core/src/settings.ts`；七个所属 package 各自提供静态 `settings.json` 和元数据，`scripts/build-settings.mjs` 生成内置描述及同语义的 AJV standalone 校验器。只缓存随构建固定的内置校验器；注册文件、外部描述及用户值每次重新读取和校验，未增加安装器或扩展执行。
- 全部消费者、包装入口、setup/self-check 源码与生成物已接入完整 ID。CLI 输出外壳和 regulation-coordinator 保留；旧主配置不再参与普通加载，独立资源迁移和恢复仍保留。使用和逐字段手工迁移见 `docs/package-settings.md`。
- 新测试覆盖层级/默认/来源/namespace 隔离、注册及原地升级、未知值警告、注释与退役入口；同时拒绝异步 schema，并保证 JSONC 中字面量 `__proto__` 不被解释成原型赋值或用于绕过必填字段。

## 验证记录

所有场景只使用仓库 `.cache` 下的合成配置、Agent 和资源；未读取或迁移设备配置，未进行真实付费 Agent、全局安装或 npm 发布。

- `pnpm exec turbo run build --force --output-logs=errors-only`：exit 0，21 个 build 成功、0 个缓存命中。
- 基础配置/CLI 定向组：61 tests，60 pass、1 平台 skip、0 fail；新增注册/编辑/退役入口组 5/5 通过。早期 CLI 输出失败来自未刷新 dist，强制构建后通过，没有复原上游输出行为。
- `pnpm exec tsx --test packages/pguide-cli-core/test/settings.test.ts packages/pguide-cli-core/test/config.test.ts packages/pguide/test/help-output.test.ts`：exit 0，27/27 通过，包含同步 schema、字面量原型键、预编译描述和新 JSONC 帮助元数据回归。
- 消费者综合组最初 93 tests 中 7 fail；逐项修复并定向复验：缺失主配置应先于扩展发现失败、发现来源路径断言、合成配置进入 Git fixture 导致 dirty source、尚未启动 Agent 就耗尽总预算时的清理断言。对应回归已通过。
- 长预算 Git setup 早期存在新增描述重复编译成本；仅进程内复用曾使定向通过，但全套并行仍失败。将内置 schema 编译移至构建、运行时使用同语义 standalone 校验器后，该用例曾在全套通过；后续再次失败说明此项并非完整根因，进一步定位和修正见文末。未延长生产超时，也未把单检查 `pilot.probe.timeoutMs` 改成整次 observation 预算。
- supervise 跨进程依赖的原失败有时间戳证据：高频观测使能力反馈排在多轮观测后，超过合成 worker 的 15 秒等待。仅把该测试的观测间隔从 500 改为 3000 ms；原 20 秒 Agent 限制、60 秒 watchdog 和生产代码未变，定向复验 1/1 通过。
- 早期完整检查的 lint 赋值表达式及异步校验标志类型错误均已修复。上游 help 测试仍断言旧 YAML `configurationSchemaVersion: 2` 的一项已改为 JSONC 格式断言，其余命令元数据和替代示例断言保留；新定向组及当前全套中的该项通过。

- 完整新鲜运行：PowerShell 设置 `$env:TURBO_FORCE='true'` 后执行 `pnpm check`，lint/typecheck 全部通过，test 阶段 42/42 tasks、0 cached；合计 559 tests，557 pass、2 Windows 平台相关 skip、0 fail，根 scripts 也实际执行。日志为 `.cache/settings-check-4.log`。该次整体 exit 1 发生在其后的 packed fixture：仅安装 `pguide` 不会创建顶层 `pguide-config` shim，不是生产入口缺失。
- 仅修正 packed fixture 为使用根命令报告的真实 bundled config 入口后，再执行完整 `pnpm check`：**exit 0**。最终日志 `.cache/settings-check-final.log`；test 42/42 tasks（41 个复用上述已成功的新鲜结果，monorepo 测试重新执行），根 scripts 重新执行，17 个 tarball 和 10 个独立消费场景全部通过，包括静态第三方注册、根/直接 config 入口一致性及 coordinator。
- 日志中的 `pguide evidence write failed` 是 `packages/objective-pilot/test/evidence.test.ts:164-190` 主动把事件文件替换为目录并断言拒绝的故障注入；新鲜运行和最终缓存回放均有该诊断，测试通过，不是忽略失败。既有 `objective-pilot/src/probes.ts:174` 的 esbuild `empty-import-meta` 警告仍存在（含缓存回放），相关源码未改，未将它误报为新失败或静默修复。
- 上一轮 `git diff --check` exit 0；布局检查曾因上游事件/新增 idea 尚未合入而阻断（候选本身有效）。主代理现已合入 `origin/main` `409b576f961867f1ee054721771b9c1af7dd5417`，该历史同步阻塞已过期，本轮修正后重新检查。

主代理只读审查发现 `editConfig` 删除属性会吞掉相邻未编辑属性的注释；本轮修正该契约缺陷并补充回归。主代理合并后启动的 `pnpm check`（shell 509）因该审查发现主动中止，不计为通过或测试失败。I-S03、I-AC02、I-AC03 暂时取消完成标记，待本轮验证恢复；D 项仍全部未完成。未提交、推送、追加事件或执行部署。

## 删除注释缺陷的审查修正

- 删除操作不再调用 `jsonc-parser.modify(..., undefined)`：AST 只定位目标属性自身，scanner 跳过 trivia 定位其后的逗号；没有后续逗号时才定位前一属性后的逗号。最多删除属性和逗号两个范围，不格式化周围文本，不猜测注释归属；范围外的属性、注释、空白和换行原样保留。不存在的 setting 保持原文不变。
- 单元回归覆盖首/中/末/唯一项 × 行/块注释 × 有/无尾逗号 × LF/CRLF，共 32 个组合，逐字断言输出并复核剩余配置；包含嵌套数组、字符串内逗号和伪注释。CLI 回归实际执行四次 `config unset`，包括主代理提供的原始复现，逐字核对落盘内容。
- `pnpm exec biome check`（本轮三个 TS 文件）、`pnpm exec turbo run build --filter=@potential-guide/pguide-config --output-logs=errors-only`、`pnpm exec tsc -p tsconfig.test.json --pretty false` 均 exit 0。首次构建发现 JSONC 库的 ambient const enum 与 `verbatimModuleSyntax` 不兼容，已改用扫描器定位后的字符比较，未引入数字 token 常量。
- `pnpm exec tsx --test packages/pguide-cli-core/test/settings.test.ts packages/pguide-config/test/config-command.test.ts`：exit 0，52/52 通过，直接执行而非缓存回放；日志 `.cache/settings-delete-targeted.log`。
- 本轮完整 `pnpm check` 实际 exit 1（`.cache/settings-delete-check.log`）：长预算 Git setup 用例再次在约 38 秒以 `All fibers interrupted without error` 中断，符合既有 30000 ms 总观测预算触发特征；不是注释删除断言失败，也不是 shell 509 的主动中止。本轮没有改动 setup 或生产预算。
- 随后执行 `pnpm exec turbo run test --filter=@potential-guide/objective-pguide-setup --filter=pguide --concurrency=1 --output-logs=errors-only`，串行实际复验仍 exit 1（`.cache/settings-delete-serial-tests.log`）：pguide 为 111 tests、110 pass、1 平台 skip；setup 为 35 tests、34 pass、1 fail，同一 Git 长预算用例约 39 秒再次中断。因此不能将它仅归咎于两个 workspace 并行，也不能宣称整体已通过；未再次无差异重跑完整套件，没有放宽测试、跳过用例或扩大生产预算。
- 当时 `git diff --check` exit 0；`silvermoon check --worktree --audience agent` exit 1、`candidateSnapshotValid: true`，原因是其他 idea 的 primary 历史更新。主代理随后已正常合入 `f8efdffd7a15ec179544b2e6c75f98b67c08d952`（仅文档/事件），此同步阻塞已过期；未修改其他 idea。

## 长预算用例的有界性能修正

- 仅对确切用例 `Git subdirectory snapshot coordinates long local budgets and existing file-auth ACP to terminal` 开启既有 `PGUIDE_TIMINGS`/合成 evidence，并用一次性进程探针分离配置读取、模块初始化、metadata 子进程与 Git source 准备。未重做全库审计。临时探针、测试分支和配置计时代码均已移除；原断言及真实执行路径保留。
- 修正前精确复现 exit 1：两个 configuration 阶段为 8618/9121 ms，根帮助为 4225/5202 ms，config show 为 1878/1728 ms，agents show 为 1944/1636 ms；sanity 的最后一次 probe 前后耗尽整次 observation 的 30000 ms 预算。Git source 准备为 1526 ms，不是主要成本。core build 在测试启动前完成；外层 `source.preparation` 在调用 observation 之前结束（`cli-runtime/src/pilot-source.ts`），但 sanity 子 probe 的准备和运行仍被父 observation 统一覆盖。整个测试另含 fixture Git 初始化、外层准备、第二轮拒绝验证及清理，其 wall time 不是 30000 ms observation 预算。
- 此时 19 次配置 catalog 装配合计 71.6 ms（单次最高 4.7 ms），18 次值发现/解析/校验合计 87.6 ms（单次最高 7.0 ms）。内置设置没有运行时 AJV compiler；实际 probe 进程中的 AJV 2020 属于既有 Objective runtime 校验，不能误报为设置重复编译。
- 真正放大的成本是根帮助串行执行 7 个 metadata 子进程，以及 dispatch 再探测后启动实际命令：所有进程原本都先加载完整 core 模块图。历史 `HEAD` 已有相同的 metadata 顺序及 AHP/YAML eager import，本次又增加了 JSONC parser 和生成校验器的 eager import；这是累计启动开销挤占既有总预算，不是新配置值校验耗时数秒。
- 最小修正先移除本次新增的 metadata 无需加载内容，再延迟既有 AHP SDK/YAML parser：内置描述在首次装配 catalog 时动态加载；JSONC/YAML 在实际解析/编辑时加载，AHP 仅在 `executeAhp`/`inspectAhp` 调用时加载。纯 core import 小探针从 272 ms 降至 33 ms；不并行或跳过 metadata、不缓存外部描述/用户配置/权限/Agent 资源、不改变重读和独立 sanity 检查、不扩大环境白名单或任何预算。
- 中间方案两次精确测试均 exit 0，首轮报告事件跨度 26407/27022 ms。最终方案再次分别运行同一确切测试，两次 exit 0、各 1/1 pass：首轮报告事件跨度 22231/24756 ms（该跨度是 evidence 首末事件，不替代预算定义），Git source 1299/1319 ms。配置和实际 CLI 阶段如下：

| 阶段（ms） | 最终测量一 | 最终测量二 |
| --- | --- | --- |
| configuration 两次 | 4072 / 4296 | 4126 / 4069 |
| 根 help 两次 | 1891 / 2022 | 1934 / 1911 |
| config show 两次 | 869 / 941 | 856 / 857 |
| agents show 两次 | 1077 / 1072 | 1099 / 1062 |
| sanity probe / regulate / probe | 2945 / 4083 / 2950 | 2965 / 6222 / 3435 |

- 四次成功均是保留所有断言的完整单用例运行，包含第二轮缺少授权环境变量应失败、原登录文件不变、scratch 清理及只允许一次 Agent session/prompt；不是 retry 或只取偶然成功。独立后置微探针中最终根 help 为 1569/1693 ms、config show 为 718/797 ms、agents show 为 930/954 ms。日志与纯合成 evidence 在 `.cache/settings-budget-before*`、`.cache/settings-budget-after-{1,2,3,4}*`。
- 新增独立进程回归，阻止 metadata-only core import 偷带 parser、生成校验器或 AHP SDK。`pnpm exec biome check --write`（四个本轮 TS 文件）、`pnpm --filter @potential-guide/cli-core build`、`pnpm exec tsc -p tsconfig.test.json --pretty false` 均 exit 0。合并执行 core 的 settings/config/agents/ahp 和 config-command 五个测试文件：exit 0、109/109 pass；日志 `.cache/settings-budget-regressions.log`，包含实际 YAML 迁移/资源解析、AHP 取消与权限、注释删除落盘回归。

- 移除所有临时探针并重新构建后的确切测试：`pnpm exec tsx --test --test-name-pattern='^Git subdirectory snapshot coordinates long local budgets and existing file-auth ACP to terminal$' packages/objective-pguide-setup/test/setup-objective.test.ts`，exit 0、1/1 pass，用例 38862 ms；日志 `.cache/settings-budget-final-targeted.log`。
- 随后本轮唯一一次完整检查：PowerShell 设置 `$env:TURBO_FORCE='true'`，执行 `pnpm check`，**exit 0**。lint/typecheck 均通过，test 为 42/42 successful tasks、0 cached，22 个 runner 合计 **603 tests、601 pass、2 平台 skip、0 fail、0 cancelled**；setup 35/35 通过，包括长预算 Git 用例（48350 ms，含完整双轮流程）。生成产物检查、17 个 tarball、10 个独立消费场景全部通过；日志 `.cache/settings-budget-final-check.log`。所有测试实际重新执行，不以历史缓存替代本轮证明。
- 完整日志仍有既有 `empty-import-meta` esbuild 警告及 evidence 故障注入诊断；含义与上文对应，相关用例均通过。没有缓存回放的未知失败，也没有把诊断隐藏成成功。
- 最终文档及 ledger 更新后的 `git diff --check` exit 0。`silvermoon check --worktree --audience agent` 仍 exit 1、`candidateSnapshotValid: true`：第一次检查时 primary 为 `7c568946c32824588567e55b9fb45572e6be014e`，最终检查时已进一步推进到 `71796d853ff991c7f966522853947582f778cb54`；两次均为其他 idea `01M5EFD1DW5J6MBE9BKCRFW5W3` 的 `not-append-only (append)`。最终日志 `.cache/settings-budget-layout.log`。这是主代理后续正常同步的外部前提，不是本 idea 内容或生产验证失败；未修改其历史、文件或 ideal。

实现和行为验证已完成，I-S03、I-AC02、I-AC03 恢复勾选；D 项仍全部未勾选。没有未决行为/预算决定。主代理须刷新并合入最新 primary、重新通过布局检查，再处理准确实现门限；未提交、推送、追加事件或执行部署。

## `71796d853ff9` 上游集成验证

- 主代理已将 `f8efdffd7a15..71796d853ff9` 合入本 worktree；本次含 level-attainment 的生产、测试、Objective 和生成物变更，并非仅文档。原有 603 项新鲜验证仍是旧基线的有效历史证据，不能代替本次集成验证；验证期间暂时撤回 I-S03/I-AC02/I-AC03，以下完整验证通过后恢复，D 不变。
- 有界核对仅覆盖该上游差异与当前配置改动的交叉：保留 Objective v2、内置 initial、terminal 目标别名、levelUp/达成级别、监督/调控新版本及新测试；保留 setup/self-check 的 installed/configured/verified 和 sanity fixture 的 initial/repaired 断言，不恢复旧层级语义。
- 主代理解决的 regulator 冲突已核对：`--target initial` 使用防御性 intrinsic binding，既不要求 Agent profile 也不读取默认 Agent；其他 target 读取 `agents.defaultAgent`。Biome 核对通过。上游新增 intrinsic 测试原本仍传 `--config`/旧主配置，现改为真实 `.pguide/config.jsonc`、`cli-core.stateDirectory` 和 `--cwd`；原有“业务检查不得执行”、零迭代及正常持久化 lifecycle 断言全部保留。
- 上游触及的其余配置夹具已使用既有 test-only 转换入口进入真实 JSONC 发现；setup 中唯一显式 `subject.configPath` 保留为必须返回 400 的拒绝回归，不把它重新纳入输入契约。未发现需要新增行为决定的交叉冲突。
- `pnpm run build` exit 0，21/21 build（13 执行、8 复用成功缓存），按依赖顺序刷新 setup/self-check、monorepo-standard 等既有生成脚本。随后 schemas/self-check/health/monorepo/setup 五个 `--check` 和 `tsc -p tsconfig.test.json` 均 exit 0；刷新后没有额外生成物差异，证明自动合并的产物与当前源一致。日志 `.cache/settings-integration-build.log`。
- 合并执行四个文件的最小相关 selectors（`tsx --test --test-concurrency=1 --test-name-pattern='^(initial regulation|setup Pilot strictly|configuration reports|Git subdirectory snapshot|self-check manifest loads|self-check committed snapshots|ordinary independent package|regulate and continue expose)'`）：exit 0、8/8 pass。覆盖无 Agent initial、普通 regulate/continue 配置消费、setup 拒绝旧 subject 字段、setup/self-check Git 快照与新层级、monorepo 依赖版本；长 setup 用例 39007 ms，预算与断言未改。日志 `.cache/settings-integration-targeted.log`。

- 当前集成基线 `71796d853ff991c7f966522853947582f778cb54` 的 `pnpm check` **exit 0**：lint、typecheck、生成物检查通过；test 为 42/42 tasks（29 cached，包含 21 个 build 与 8 个 test；13 个 test 任务实际执行）。22 个 runner 合计 **610 tests、608 pass、2 平台 skip、0 fail、0 cancelled**。配置交叉的 core、regulator CLI、setup/self-check 和 monorepo 均实际执行；长 setup 用例 39868 ms。17 个 tarball 和 10 个独立消费场景全部通过，日志 `.cache/settings-integration-check.log`。
- 为避免将上游新增测试仅作为缓存证明，随后直接用 `tsx --test` 合并重跑本轮命中缓存且有上游修改的六个包：pilot-protocol、objective-pilot、objective-regulator、objective-portfolio-supervisor、regulation-coordinator、objective-devbox-health。**exit 0，194 tests、193 pass、1 平台 skip、0 fail**，全部实际执行；日志 `.cache/settings-integration-upstream-fresh.log`。补充验证前后没有源码或依赖变化，无需重复全套；未变的 effects/git-source 成功缓存保留复用。
- 完整日志的 `pguide evidence write failed` 来自上游成功缓存中的既有故障注入，旧 worktree 路径只是日志回放，并未访问其文件；补充新鲜 objective-pilot 测试也通过。既有 esbuild `empty-import-meta` 警告仍保留。不存在未解释的失败日志。
- 最终 `git diff --check` exit 0。本轮 `silvermoon check --worktree --audience agent` exit 1、`candidateSnapshotValid: true`：primary 又推进至 `a465e49df173e893f66b01d68126538206134d9b`，仍仅其他 idea `01M5EFD1DW5J6MBE9BKCRFW5W3` 的 `not-append-only (append)`；日志 `.cache/settings-integration-layout.log`。按主代理指示不追逐该外部历史、不重做无关审计，由主代理尽快正常同步并处理准确门限。

当前集成实现验证已通过，I-S03/I-AC02/I-AC03 恢复勾选，D 全部未完成；未改 ideal、其他 idea、stash、Deployment 或设备，未提交或推送。
