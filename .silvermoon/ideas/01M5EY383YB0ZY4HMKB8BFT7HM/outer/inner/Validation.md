# 实施证据与验证边界

## 已落地的两条主线

- 通用 `PilotRuntime.observationRevision` 是显式能力，默认关闭。缓存只在 enclosing
  observation scope 内保存已完成且有 payload 的完整观察，不合并在途请求。
  key 包含完整 spec/source、subject、有效语言、模式、runtime 身份与输入 revision，
  不把规则 tree/commit 当成目标稳定性证明。不同 expected level 独立比较同一事实。
- CLI 读取 committed `observation-inputs.json` 的严格只读契约。standard 两入口的
  descriptor 由既有生成器生成，包级 root pointer 为 `["root"]`，根为
  `["context","repo","rootPath"]`。未声明的任意 check 保留原执行行为，不启用复用。
- 宿主独立采集受限文件事实，以第二次字节遍历校验，构造整轮不可变视图；
  类型、文件名、可读字节和已有构建产物均在视图中。不是让 check 返回 inventory，
  也没有把公共事实塞入 subject。输入捕获包含在总观察预算中。
- 宿主为同一实际 root 共享一份私有视图文件，SHA-256 绑定进程元数据。standard 的
  Snapshot 校验 digest/root 并仅从该视图读取；缓存命中前宿主再次验证传递文件。
  子进程不能以任意自报的“通过”结果替换公共采集。规则代码仍是被选定来源的可信判断者，
  只读声明不是识别恶意规则副作用的沙箱。
- 视图统一路径越界、链接、秘密文件及其目录、ignored 路径、单文件 1 MiB 和 inventory
  20000 文件边界。采集额外限制 40000 条目、128 MiB 可读字节。打开文件后校验文件身份，
  不读取秘密值、跟随目录链接或接受进程自报内容。两次遍历不一致、不可读或超限时，
  回到原 live 检查且不启用缓存，而不是省略检查。
  ignored 的显式读取限制仅适用于输入视图；live/独立读取恢复原行为，不受新契约影响，
  其 inventory 仍按原规则排除 ignored 目录。
- 每轮视图在根观察退出时清理，包括失败、截止和取消；资源回收错误不掩盖主错误。
  来源作用域等待实际子进程退出再删除 checkout；准备阶段及运行阶段都传播取消。
  视图文件排他创建，写入中途失败会关闭句柄并删除仅由该次操作创建的残片；
  取消与清理同时失败仍保留两个原因。
  捕获后并发修改目标不会让当前各层混用新旧输入，下一根观察重新采集。采集不是操作系统
  原子快照，两次遍历校验不承诺对抗恶意 ABA 写入；契约是已捕获的受限只读视图。
- 独立包无视图时仍观察所有实际包 manifest 与公共配置。受支持 pnpm pattern 引导
  manifest 目录发现，源码 inventory 仅展开本包；未知 pattern 退回全仓观察和原诊断。
  根的结构前置判断、源码导入的不同语义判断及独立包入口均未删除。

## 预算与可测量性

公开配置为 `pilot.probe`：

```json
{
  "timeoutMs": 300000,
  "checkTimeoutMs": 300000,
  "preparationTimeoutMs": 300000,
  "observationBudget": {
    "timeoutMs": 300000,
    "maxDepth": 32,
    "maxObservations": 128
  },
  "retry": { "maxRetries": 0, "delayMs": 0 }
}
```

该示例只用于同等预算测量，不是新的默认值。默认来源准备 60000ms、总观察 30000ms、
深度 32、逻辑观察 128；单 check 保留 `timeoutMs` fallback。Regulation 外层 deadline
仍使用 `timeoutMs`，不会被 `checkTimeoutMs` 或每次懒准备重新起算。
probe 的取消 signal 已传入根来源准备；本地 Git inspection 也受准备截止和取消约束。
懒依赖来源准备有自身阶段截止，并继续消耗当前总观察预算。

`PGUIDE_TIMINGS=1` 输出 `source.preparation`、`input-view.capture`、`observation` 阶段，
后者区分 executed/reused/logical observations。来源准备、总截止、深度/次数、单进程截止
分别保留 `source-preparation-timeout`、`observation-timeout`、`observation-budget`、
`check-timeout` 标识，不再把内部 fiber interruption 当成唯一错误。
真实计数必须覆盖宿主采集及 checks，不能只数子进程中的 Snapshot。

## 针对性证据

- `pnpm --filter @potential-guide/objective-pilot test`：最终完整校验 60/60 通过；新增文件
  7/7 定向测试通过，覆盖来源/runtime 区别、缓存递归、资源清理及链接/秘密/大小边界。
- `pnpm exec tsx --test packages\pguide\test\pilot-source.test.ts`：16/16 通过，含真实 Git
  来源、进程/IPC、三类来源/观察/check 截止、整轮视图与新轮采集、视图逐轮删除。
  补充后定向 4/4 证明懒依赖准备的自身截止与原总截止分别生效，以及视图残片、
  来源取消进程退出、取消叠加清理异常的完整回收。
- `pnpm --filter @potential-guide/objective-monorepo-standard test`：最终完整校验 53/53
  通过；`pilot.test.mjs` 13/13 通过，覆盖独立包、根来源路由、问题归属、修复与
  Supervisor/Regulation 新轮次。额外组合 inventory 上限测试证明公共 manifest 与
  本包文件相加后仍保留 20000 文件边界，不分别计数绕过总上限。
- 一包成功路径明确断言从六次 check 变为四次：根 structure、包 structure、
  包 deliveries、根 deliveries。完整但低层级的包观察仍供后续 terminal 请求判断，
  不重跑或伪造成功；initial 保持空观察。21 包成功路径的 44 次进程假设尚须固定版本
  真实消费计数，不用该公式替代实测。
- 字节变化测试覆盖新增、删除、等长修改并恢复 mtime；语义区别覆盖 subject、语言、
  来源和 runtime；调用错误、取消、捕获期间变化不缓存为成功。缓存命中仍消耗逻辑预算，
  且不能绕过递归检查。已有伪造 dependency evidence 与进程树清理反例继续保留。
- 最终冻结源码后 `pnpm check` exit0：层级、格式、lint、typecheck、全部 tests、
  生成物检查和 isolated packed consumption 均通过。关键 suite 为 objective-pilot
  60、monorepo-standard 53、pguide 115 项；10 组独立 packed consumption 全部通过。
  `node scripts\build-monorepo-runtime.mjs --check`、
  `node scripts\build-settings.mjs --check` 与 `git diff --check` 均通过。
  构建保留原有 CJS `import.meta` 警告；真实进程/IPC 与独立 packed consumption 未受影响。
- `silvermoon check --worktree --audience agent` 验证通过，未记录事件或门限，
  未 stage、commit、push；HEAD 保持 `a163adf0cd032b9ee085225f32da72bf96585b47`。

## 固定版本测量交接

主 Agent 已冻结基线 tarball、真实 Git 来源 `a163adf0cd032b9ee085225f32da72bf96585b47`
及 21 包业务 archive，独立消费者不引用本 worktree 实时模块。其同环境、同插桩、
三层均 300s 的有效 API 基线为：

| 轮次 | 总耗时 | 观察耗时 | check 进程 | inventory | readdir / lstat / readFile |
| --- | --- | --- | --- | --- | --- |
| cold-valid | 55.363s | 44.907s | 86 | 86 | 39904 / 224056 / 2646 |
| hot-valid | 53.294s | 44.687s | 86 | 86 | 39904 / 224056 / 2646 |

两次均 standardized、0 problems。Windows PID 重用造成第一次 83 文件的插桩轮次已作废；
有效计数采用 PID + UUID。基线真实 CLI 默认预算另复现 36.364s / code2 /
`All fibers interrupted without error`。以上由主 Agent 提供，原始报告在其 session
measurements，不复制进 ideal。旧 110–124s 历史数据与本轮不同环境，不能混比。

候选消费入口不变：固定 Git Pilot URI、候选完整 commit、相同 subject-file 和独立安装 CLI；
API 使用 `withPilot(..., {probeTimeoutMs, preparationTimeoutMs, observationBudget})`。
CLI 按上面的 `pilot.probe` JSONC 配置；隔离 HOME/USERPROFILE/APPDATA/XDG_CONFIG_HOME
避免本机旧配置先于预算校验失败。候选必须使用相同 tarball overrides、目标 archive、
Node、三层预算、报告设置和插桩。主 Agent 负责提交同步、候选冷/热实测、真实 CLI
默认预算/显式预算/取消验证及门限审批，本文件不声明这些已经完成。

宿主为校验文件身份使用 `open → FileHandle.stat/readFile → close`。原 preload 仅统计
命名导出 `fs.promises.readFile` 时，其计数不能代表新路径的全部读取；对比应同时覆盖
FileHandle 的读取、open/fstat/realpath，或明确旧计数仅是该 API 子集。不要把方法变化
误报为实际 I/O 消失。`input-view.capture` 事件是实际捕获数，资源计数还包含 root alias
解析资源，不能直接当作视图数量。
旧 TypeScript 系统宿主还可能执行同步 FS 操作；仅 promises 插桩不能代表该部分，
跨版本比较须区分同步/异步 API 子集。候选视图模式的 TypeScript 读取不再访问目标 FS。

## 测量前交接的边界

- 当时 `I-AC02` 尚待固定版本消费者验证；现已由下面的最终证据补齐，不以先前的
  次数公式或单测替代真实测量。
- 视图契约不支持显式读取 node_modules、.cache 等排除目录；未启用视图的 live 消费者
  不受该限制影响。定向测试同时验证 live 可读取、inventory 仍排除、view 明确拒绝。
- 只读声明是规则来源的明确契约，不是任意外部 check 的纯度证明或 OS 沙箱；
  存在外部状态决策的来源不应声明该契约。规则没有声明时保留原行为且不复用结果。
- 视图序列化与每进程解析成本随输入体积增加，128 MiB 为可读原始字节上限；
  测量须包含宿主捕获、传递和进程解析，不只统计减少的子进程 inventory。

## 门限审阅收紧

2026-10-21 按主 Agent 审阅修正两点，不改变 ideal 或事件：

- live 显式读取不再被视图的 ignored 限制影响；新增对照测试证明兼容性，视图模式仍明确
  拒绝排除路径，不以缺失文件伪装成功。
- 捕获器使用内部预期不可用类型及明确的文件系统错误码集合。只有 input-changed、
  inventory-limit、byte-limit、unreadable 可回退；TypeError 等编程错误与取消保留原异常。
  两个 API 包装均提供第三参数 `onUnavailable`；CLI 记录 `input-view.unavailable`
  evidence，启用 timings 时输出带 Objective、reason/code 的 unavailable 事件。
  默认库 timing 也支持原因记录；明确关闭 reports 和 timings 才不输出这两个通道。
  descriptor 已声明但 subjectRoot 无法解析时抛出契约错误，不静默禁用视图。
- 新增反例证明 ENOENT 的预期诊断、两次遍历变化的 input-changed、原样传播的编程异常、
  原样传播的取消；真实 Git/进程集成测试注入 EACCES，证明 live 业务检查仍执行且
  `input-view.capture/status:unavailable` 具有 reason、code 与 Objective 身份。
- 修复 `observePackageLayers` 原先两处 `ts.sys` 实时读取：视图模式的同步 TypeScript
  host 从捕获事实实现 readFile、fileExists、directoryExists、getDirectories、realpath、
  readDirectory；后者使用绑定版本的 TypeScript matchFiles，保留 extends/glob/alias
  的实际解析，不另写简化 glob 或删除检查。该宿主仍在独立 check 进程内运行。
  为保持 TypeScript 文件读取语义，视图对 UTF-16 BOM 文件额外保留原字节，
  宿主保留 UTF-8/UTF-16 LE/BE BOM 解码；Snapshot 原有 UTF-8 text 行为不变。
  live 模式继续使用原 TypeScript 系统宿主及既有 options-only 诊断行为，
  对照测试保留该兼容性。视图的边界访问明确报错，不回退实时目标；
  配置解析错误不能留下部分 options 后忽略 alias。无输入的诊断由实际 inventory 覆盖，
  不是删去源文件检查。
- 反例先捕获高层 alias 目标及继承配置，再分别删除实时 alias 目标、修改实时 extends
  内容为低层；视图仍正确报告原来的 low → high，live 与新视图反映新输入。
  测试把 ts.sys 全部六类 FS 方法替换成抛异常，证明视图路径不调用它们；同时对照
  TypeScript 自身的 glob 结果。排除目录中的 extends 在 live 保留原解析，视图明确失败，
  不静默变成 unsupported 或忽略 alias。真实 bundle/进程测试也在捕获后损坏 live
  tsconfig.base.json，要求根观察继续消费原有有效视图。
- 补充检查 `src` 的 node:fs、ts.sys、配置/模块解析 API、process 输入面：目标 FS 直接
  读取集中在 Snapshot；TypeScript 的两处旁路已改为上述 host。其余导入分析只解析
  Snapshot 提供的源码文本。环境读取仅为宿主视图路径/digest 元数据，规则/证据文件
  读取不替代目标事实；没有发现其它绕过 Snapshot 的目标文件读取面。
- 审阅修正后的最小组合 runner 9/9、真实 CLI runtime 回退诊断 1/1、真实 bundle
  视图进程 1/1 通过；TypeScript 分层 runner 6/6（含旧 live options 兼容）通过。
  更新生成物后完整 `pnpm check` 再次 exit0：60/53/115 项关键 suite 及全部独立打包
  消费通过。未提交、未记录事件；最终固定版本消费仍交由主 Agent。

## 最终固定版本验收证据

主 Agent 对审阅修正后的候选 `e4a7428bc969` 进行了独立安装及 HTTPS Git 固定版本消费，
基线为 `a163adf0cd03`。完整原始观察、来源 tree 校验、逐 check 身份、计数、CLI 原始
stdout/stderr、第三方版本及 tarball SHA-256 见 [performance.json](./performance.json)。
两个消费者各自安装八个实际打包包，以本地 tarball overrides 固定内部依赖；11 个第三方
包版本完全一致，均使用 Node v24.12.0、pnpm 11.22.0，不引用实时 workspace 模块。

### 最终冷/热对照

四次按基线冷、候选冷、基线热、候选热交错执行。每次均为新 Node 进程与新的来源/观察
作用域；热表示后续重复，不保留旧 observation。未清空操作系统缓存，不代表磁盘冷启动、
统计分布或 SLA。观察与单 check、来源准备均显式为 300000ms，API reports 与
`PGUIDE_TIMINGS=1` 相同。目标始终是基线提交的 archive 加基线 dist，共 1390 个文件、
16337057 字节；字节/路径摘要与 tarball 摘要在 JSON 中。变化反例恢复了原始字节。

| 轮次 | 基线总耗时 | 候选总耗时 | 基线观察 | 候选观察 | 观察下降 |
| --- | --- | --- | --- | --- | --- |
| 冷 | 83.666s | 29.549s | 45.572s | 22.199s | 51.29% |
| 热 | 56.907s | 32.777s | 45.628s | 22.536s | 50.61% |

来源准备存在明显网络波动，基线冷轮约 38 秒、候选冷轮约 7 秒；因此不能将总耗时差额
全部归因于本优化。更稳定的同输入观察阶段约减半，且下列确定性工作量在冷/热均一致。
历史 110–124 秒、早期 v1/v2/v3 插桩及 pnpm 环境未统一的试跑均不作为这张最终表的对照。

| 工作量（宿主与子进程合计） | 基线 | 候选 |
| --- | --- | --- |
| check 进程 | 86 | 44 |
| 根 inventory 遍历 | 86 | 2 |
| 宿主输入捕获 | 无 | 1 次捕获，内部两次字节遍历 |
| 实际 / 复用 / 逻辑观察 | 43 / 0 / 43 | 22 / 21 / 43 |
| readdir | 39938 | 1016 |
| lstat | 224056 | 3760 |
| realpath | 86 | 3759 |
| open / FileHandle.stat / FileHandle.readFile | 0 / 0 / 0 | 2775 / 2774 / 2774 |
| promises.readFile | 2673 | 136 |
| 上述 API 实际读取字节 | 6620693 | 903261642 |
| 其中目标文件读取字节 | 6598507 | 15520625 |

不能把 promises.readFile 下降等同于全部读取减少：候选包含 FileHandle 捕获，并重复校验、
传递和解析约 8.30 MB 的视图，导致计数范围内读取字节明显增加。这是保留独立进程、
可信视图与逐调用完整性校验的成本；当前输入的墙钟仍下降，但不是所有规模都已有收益
证明。该指标还不包含 Git/tar 原生 I/O 或旧 TypeScript 的同步 FS API，不能冒充物理磁盘
流量。后续如需要，应先测量受限视图投影/传递成本，不能删完整性检查来降低计数。

### 原始故障、预算和变化反例

- 基线真实 CLI 默认预算复现 code2 / `All fibers interrupted without error`。
  候选默认值未加大，真实 CLI 在约 22.080 秒观察后 standardized、0 problems、code0；
  含准备总耗时 35.014 秒，所以不宣称整条 CLI 小于 30 秒。
- 显式配置三层 300000ms 的 CLI 同样通过，约 22.424 秒观察、52.552 秒总耗时；
  时间差主要来自来源准备。隔离用户配置，没有修改本机旧配置文件。
- 从已安装 CLI 分别将来源准备、整次观察或单 check 设置为 1ms，实际得到
  `source-preparation-timeout`（code2）、`observation-timeout`（code2）、
  带 Objective/level/check 身份的 `check-timeout`（504 / code6）。
  来源准备耗时不算入后两者的 1ms；清理也不承诺在 1ms 内结束。
- 同一个已安装 runtime 中依次成功观察、删除 effects README、再次观察、恢复并重观察：
  成功 → initial/dependency → 成功；失败归属仍为包 Objective、expected structured、
  current initial，修复后没有旧结果命中。每轮均新建并删除视图。
- 包级 Git Objective 单独消费成功，来源集合只包含包 Objective；没有借用根的通过结论。
- 在真实嵌套检查的第三个进程启动后取消，错误保留测试取消原因；三个进程均已 close，
  它们的临时目录与共享视图文件均 ENOENT 后调用才返回。
- 整合并发的其他 Idea 文档后，主 Agent 再次运行完整 `pnpm check`，exit0；
  代理的定向/整套反例与生成物检查证据仍有效。代码没有在测量过程中继续改动。

### 复现入口

Windows 测量程序保存在 [measure-probe.mjs](./verification/measure-probe.mjs) 与
[probe-count-preload.mjs](./verification/probe-count-preload.mjs)。它们与本轮实际测量
程序一致；文件操作计数覆盖宿主、checks 及 FileHandle，记录采用 PID + UUID。
该程序是测量工具，不是运行时功能，也不自动安装依赖。

在仓库外准备一个共同父目录：`baseline-target` 为相同业务 archive 加相同基线 dist；
`baseline-consumer`、`candidate-consumer` 各自用对应提交构建并经 pnpm pack 的八个包
安装，内部依赖必须全部 override 到对应 tarball。pnpm 11 的 overrides 放在各消费者的
pnpm-workspace.yaml，而不是已不读取的 package.json `pnpm` 字段。
将测量程序复制到两个消费者目录，把 preload 放在共同父目录。设置
`PGUIDE_TIMINGS=1`、`PROBE_SOURCE_COMMIT` 为相应完整提交，依次运行：

```powershell
node .\baseline-consumer\measure-probe.mjs baseline-cold
node .\candidate-consumer\measure-probe.mjs candidate-cold
node .\baseline-consumer\measure-probe.mjs baseline-hot
node .\candidate-consumer\measure-probe.mjs candidate-hot
```

每次使用新的 label，避免把已有进程记录合入新一轮。程序保存 observation、逐进程
计数和 summary；核对来源 commit/tree、两者第三方版本及输入摘要后再比较。
完整输入摘要、实际提交、包摘要与本次原始结果以 performance.json 为准。
