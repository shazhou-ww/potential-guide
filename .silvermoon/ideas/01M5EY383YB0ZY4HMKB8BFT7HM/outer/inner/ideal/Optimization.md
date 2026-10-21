# Probe 优化方向与已知基线

本文为构想的瓶颈依据与取舍说明，不代表优化已完成，也不预先锁定缓存或 worker 架构。

## 实测基线

2026-10-21，Windows、Node v24.11.1，在本项目提交
`df96b4958d7cdf3b27e3650f76b03d9836fd224c` 上以根 standardize 声明投影的
subject 观察真实 monorepo-standard Objective。完整观察得到 standardized、0 个问题，
terminal 目标解析为 standardized，规则和包级依赖均固定同一提交。

首次成功运行约 124.5 秒；随后带子进程诊断 preload 的一次运行为 109.7 秒。
诊断轮次包含插桩开销，不能作为严格冷、热性能分布或跨设备 SLA。

| 指标 | 诊断轮次 |
| --- | --- |
| 来源准备 | 3.7 秒 |
| 根 structure（含依赖） | 55.5 秒 |
| 根 deliveries（含依赖） | 50.2 秒 |
| 包数量 | 21 |
| 包检查次数 | 84，每包 4 次 |
| 总检查进程与全仓 inventory 次数 | 均为 86 |
| 包检查累计耗时 | 98.9 秒 |
| lstat / readdir 调用数 | 279,564 / 46,354 |
| 包进程首次 inventory 前累计耗时 | 46.6 秒，包含模块加载和初始化 |

根阶段时间已包含包级时间，不可重复相加；文件操作累计耗时也不是互斥墙钟阶段。
没有发现单一包卡死，不能把来源准备误判为主要瓶颈。

默认预算另行复现：观察开始后 30.012 秒触发
`Dependency observation deadline exceeded.`，最终 CLI 只输出
`All fibers interrupted without error`。单 check 默认也为 30 秒，但本次追踪已直接捕获
整体观察截止计时器；仅调整单 check 配置不足以解决整体预算问题。

## 优化次序

两条性能主线是「完整观察结果去重」和「公共事实采集分层」。第二条不是单纯调换执行
顺序，也不是上层通过就省略下层检查，而是采集一次可验证的事实，再由各层独立判断。

先建立三层预算、超时原因和计数底座，再分别实施、测量两条主线。worker 与并发只在
两条主线实测后按剩余瓶颈决定；预算诊断是可靠性工作，不计作性能收益。

## 2026-10-21 源码调研

本次核对独立 worktree 的提交 `eeb819d9154a`，未修改运行时代码。以下源码链接相对
本文件；历史耗时仍来自上面的旧基线，不是本次重测。当前环境为 Windows、
Node v24.12.0、pnpm 11.22.0，与旧基线的 Node 版本不同，不能直接合并成性能分布。

### 完整观察与层级判断已经分开，但没有结果复用

- [checkRepository](../../../../../../packages/objective-monorepo-standard/src/structure.ts)
  在根 structure 阶段为每包请求 `structured`，在根 deliveries 阶段请求 `terminal`。
  两个阶段都先执行仓库公共检查，再在没有阻断问题时顺序请求包依赖。
- [checkObjectiveLevel](../../../../../../packages/objective-pilot/src/dependency.ts)
  除 `initial` 外会调用完整 `observe`，得到 observation 后才比较 expected level。
  因此 `structured` 请求也会观察包的后续层级；不能把它误当成现有短路机制。
- 同文件的 `Scope.bindings` 只缓存 Objective 的 spec/runtime 绑定 Promise；
  `Scope.evidence` 用于校验当前观察的依赖问题，不是 observation 结果缓存。
  `bindDependencyRequest` 每次请求仍创建 dependency probe 并重新观察。
- [observe](../../../../../../packages/objective-pilot/src/pilot.ts)
  按 manifest 的层级顺序执行；同层支持 `checkConcurrency`，默认 1。
  不能用移动层级或提高局部并发代替依赖观察去重。
- 现有[真实进程测试](../../../../../../packages/objective-monorepo-standard/test/pilot.test.mjs)
  明确断言一包成功路径的六次调用：
  根 structure、包 structure、包 deliveries、根 deliveries、包 structure、包 deliveries。
  这是现有行为断言；未来去重时须同时修改次数预期并保留结果、归属和来源验证。

全通过路径的工作量关系因此是 `2 + 4N`；若同轮两个目标可安全复用一份包完整观察，
则有望变为 `2 + 2N`。21 包对应 86 → 44 个检查进程、84 → 42 次包检查。
这不是所有失败路径的次数承诺，也不代表耗时严格减半。

### 公共事实重复来自各个独立 check 的重新采集

- [checkPackage](../../../../../../packages/objective-monorepo-standard/src/package-standard.ts)
  每次调用都会创建 `Snapshot` 并执行 `observeRepository`。`maxLayer === 1` 的返回位于
  公共事实采集和包结构判断之后，deliveries 调用也会重做这些前置工作。
- [observeRepository](../../../../../../packages/objective-monorepo-standard/src/repository-observation.ts)
  先全仓 inventory，再读取 workspace 配置、根 Turbo/包元数据以及所有已发现包的 manifest。
  所以独立包检查目前并非只读取自己的目录；其他包元数据也参与依赖与身份判断。
- [Snapshot](../../../../../../packages/objective-monorepo-standard/src/shared.ts)
  的 `files` 递归扫描目录，`text`/`json` 没有读缓存，`path` 对路径组成逐段进行 lstat。
  该类是受限读取器，不是原子文件系统快照；实例名不能作为可复用性证明。
- 根 [checkRepository](../../../../../../packages/objective-monorepo-standard/src/structure.ts)
  两个阶段还会重复调用上述仓库观察和结构前置检查。
  [包层级检查](../../../../../../packages/objective-monorepo-standard/src/package-layers.ts)
  与[包来源边界检查](../../../../../../packages/objective-monorepo-standard/src/source-boundaries.ts)
  都会读取、解析源码，但判断语义不同：可评估共享文件内容/导入事实，不可直接删去一方规则。

只给某个 check 进程内的 `Snapshot` 加 Map，不能解决跨进程重复采集。共享公共事实需要
独立处理传递成本、输入有效性和可信边界，不能默认为通用进程协议已经支持。

### 三类预算存在于不同入口，当前没有贯通

| 预算 | 当前入口与行为 | 调整重点 |
| --- | --- | --- |
| 来源准备 | [PilotSourceOptions](../../../../../../packages/cli-runtime/src/pilot-source.ts) 的 `preparationTimeoutMs`，默认 60 秒；根来源准备完成后清除该计时器 | 对外暴露配置和阶段身份，区分根准备与观察过程中懒加载的依赖来源准备 |
| 整次观察 | [observationScope](../../../../../../packages/objective-pilot/src/dependency.ts) 的 `runtime.observationBudget`，默认 30 秒、32 层、128 次观察；子观察共享总预算 | 经 CLI runtime 显式传递，保留总截止与递归/次数限制，明确命中复用后的计数含义 |
| 单 check | [createProcessCheckProbe](../../../../../../packages/objective-pilot/src/probes.ts) 的 `timeoutMs`，默认 30 秒 | 保留具体 check 身份、耗时及进程树清理，区分自身超时与上游取消 |

[runProbe](../../../../../../packages/pguide-pilot/src/commands/pilot.ts)
当前把 `pilot.probe.timeoutMs` 传入 `withPilot.probeTimeoutMs`，后者用于单进程 check；
构造的 runtime 没有设置 `observationBudget`。所以调大这个配置不会改变整次观察的默认
30 秒。来源准备虽已有 API 选项，但同一 CLI 调用没有传入该项。

`runProbe` 的取消 controller 传给了 `observe`，没有作为 `withPilot` 的 `options.signal`
传入来源准备。预算工作还需检查准备阶段取消的传播，而不只是增加计时字段。
[配置说明](../../../../../../packages/pguide-pilot/settings.json)
及 regulate、supervise 的共享调用面必须一起核对，不能把 Regulation 外层 probe
截止、单 check 截止和整次观察截止混为同一个含义。

### 独立运行时计数实验

使用当前仓库已有的 `runtime/pilot-checker.cjs`，以一个临时 workspace 构造合法的
internal 包：声明 `src/index.ts`、README、build/check scripts、workspace 与 Turbo 配置，
无本地或联合交付。实验用脚本包装 `node:fs/promises.readdir`，只统计参数等于真实仓库
根目录的读取次数，以对应 `Snapshot.files("")` 的全仓 inventory 入口。

| 场景 | 实际结果 |
| --- | --- |
| 独立包依次调用 `checkPackage(subject, 1)` 与 `checkPackage(subject, 2)` | 两次报告均 pass；根目录扫描 2 次 |
| 根依次调用 `checkRepository(subject, 1, dependencyProbe)` 与 `checkRepository(subject, 2, dependencyProbe)` | 两次报告均 pass；依赖目标依次为 structured、terminal；包 check 4 次；根目录扫描共 6 次 |
| 删除该包 README 后再次执行结构检查 | 报告 fail，包含 workspace-file 问题；重新扫描 1 次 |

第二个场景注入的 dependency probe 每次依次执行包的两个 check，模拟源码已确认的完整
包观察；没有通过真实 `observe`、IPC 或进程 transport。独立包场景和变化场景直接调用
真实 bundled checker。所有计数与报告状态均以脚本断言通过，临时目标已清理。
这验证了采集重复的机制，不是端到端性能或缓存正确性验收，不产生进程数或耗时新基线。
真实调用顺序的现有测试证据见上面的 `pilot.test.mjs`；该计数实验不依赖 workspace
安装，也不替代真实进程测试或最终的 `pnpm check`。

## 建议推进计划

这是构想可行性和取舍计划，不是已实施架构；构想尚未验收，实施须等待明确决定。

### 第一阶段：先能归因，再优化

建立同输入的成功、失败和截止基线，分别记录来源准备、完整观察、根/包 check、
inventory、文件读取、进程启动与清理；区分插桩开销与正式计时。
先贯通预算与错误身份，保留原始原因、Objective/check 标识和取消来源，
不通过单纯延长超时制造“优化成功”。

阶段出口：能独立触发三类截止，能区分用户取消和超时，准备及检查阶段的进程和资源均
完成清理；此时记录收益为零或实测值，不预先承诺 30 秒 SLA。

### 第二阶段：先减少完整包观察次数

优先研究由宿主 observation scope 管理同轮有效完整观察的复用，不在各个包 check
中各做一套缓存。对不同 expected level 复用观察事实，再分别执行层级比较。

复用前必须解决：

- 语义身份：规范来源及精确版本/来源证据、subject、有效语言、观察模式和输入有效期。
  `initial` 空观察不得充当完整观察；其他 expected level 不应仅因比较目标不同就重跑。
- 目标稳定性：固定规则 commit 不固定目标工作区。须选择并验证观察期不可变视图或
  可靠的变化检测/失效机制；只按 rootPath、mtime 或单次 probe ID 建键不足以证明有效。
  任意 check 的副作用和外部状态也不能默认为纯函数；无法证明输入稳定时不得盲目命中。
- 证据与限制：复用命中仍须为当前调用方登记匹配的来源/层级证据；保留递归检测，
  明确逻辑请求与实际执行的计数，不能让缓存命中绕过深度或总预算约束。
- 失败与生命周期：完整但未达标的观察不同于执行失败；前者仅在输入稳定时可复用，
  后者及取消不存为成功。未完成请求的合并要单独验证取消所有权，不能顺手引入。
  作用域退出、修复、新 probe 或新 Regulation 轮次结束旧结果的适用期。

阶段出口：同环境 21 包全通过路径首先验证 84 → 42 次包 check、86 → 44 个检查进程
的假设；结果、current、问题归属与精确来源保持一致，再报告冷/热耗时收益。

### 第三阶段：再减少每次观察内部的公共采集

按「仓库公共事实 → 包专属事实 → 各层判断」划分职责。优先 inventory、workspace、
manifest 和公共配置，再根据计数决定是否复用源码读取/解析事实。
同规则、同输入视图下相同的结构判断才可考虑复用；不同语义判断继续独立执行。

先验证公共事实由谁采集、如何绑定来源/目标视图及校验，再选择跨 check 进程的传递办法；
不直接接受 check 自报的文件清单或“通过”结论，不把事实塞入用户 subject 绕过 schema。
保持路径越界、符号链接、秘密值文件、文件大小和 inventory 数量边界。
独立包入口没有根上下文时仍须完整采集所需仓库事实，不得省略其他包依赖信息。

阶段出口：与第二阶段结果单独比较 inventory、readdir/lstat、读取/解析次数及传递成本；
扫描显著减少且墙钟下降，独立包与根调用的结论和归属一致。若校验/传递成本抵消收益，
继续调整采集边界，不用跳检查或未经证明的缓存掩盖问题。

### 后续按测量决定，不预设框架

若剩余成本仍主要来自模块初始化，再评估同可信来源、单轮内的隔离 worker；
若存在可并行的独立工作，再测 2、4 等覆盖整条依赖图的全局上限。
目前保留层级顺序和进程隔离，不直接合并任意外部 check 到 CLI 主进程。
来源准备不是首轮性能主攻方向，但其错误、预算与取消仍属于第一阶段。

每阶段的反例至少包括：文件新增/删除/修改、工作区相同但来源/subject/语言不同、
修复与新轮次、未达标观察、执行异常、缓存候选正在运行时取消、依赖循环与预算耗尽、
伪造依赖证据、独立包入口及根结构失败阻止后续依赖。
最终补充固定版本真实 CLI/API 消费的冷/热结果、原始计数与复现条件，并执行 `pnpm check`；
本轮调研不宣称这些实施及部署标准已经完成。

## 需要先解决的取舍

- 规则源码 commit 固定并不固定 subject 指向的工作区。复用须有明确观察生命周期、
  目标变化策略、来源/subject/语言等语义输入；不得把异常或取消存成成功，不跨修复或轮次。
  同步文件读取也不天然构成原子工作区快照。
- 公共事实共享不能信任 check 任意伪造的数据，也不能去除现有路径、符号链接与秘密值边界。
- 若仍以进程初始化为主，再评估同可信来源、单次 probe 生命周期内的 worker；
  不直接将任意外部 check 搬入 CLI 主进程，不忽略请求状态与取消清理的隔离。
- 若采用并发，先测 2、4 等小规模上限；限制须覆盖整条依赖图，保持层级顺序与稳定输出，
  避免嵌套放大和并行全仓扫描争抢。
- 完整 probe 与“证明至少达到目标”是不同语义；目标达成即短路不作为默认性能修补，
  如需采用必须单独明确契约及证据形状。

## 验证原则

相同业务内容、固定规则提交、相同 subject 与环境下比较冷、热运行，分别记录准备、
观察、根/叶 checks、扫描、进程和清理；耗时报告同时注明插桩与机器差异。
优先验收工作量减少，再判断墙钟收益；预算默认值在实测后选择，不先承诺 30 秒 SLA。
覆盖文件变化、修复、新轮次、别名目标、问题归属、调用错误、截止和取消的反例。
