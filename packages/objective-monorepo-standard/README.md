# 包自有声明与仓库标准化

仓库与包标准化分别交付为两个独立 npm Objective：

- `packages/objective-monorepo-standard/`：仓库共通政策、联合交付与包 Objective 依赖协调。
- `packages/objective-package-standard/`：独立观察一个包的静态准备。

两者分别有一个根 objective.yaml，按实际包名和完整包内容 digest 固定版本。
源码共享，`pnpm build` 将运行资源、严格 subjectSchema 和许可证生成到忽略的
staging/dist，按 `dist/package` 或准确 tarball 消费，不再提交 bundle。
`pnpm monorepo:check` 校验新鲜度。完整规范见 [npm Objective 包](../../docs/pilot-packages.md)。

## 目录声明

每个 pnpm 实际发现的 workspace 必须有自己的 `objectives.yaml` / `standardize`：

```yaml
$schema: https://shazhou-ww.github.io/potential-guide/schemas/objectives/v1.json
objectives:
  standardize:
    description: Prepare this internal library.
    objective: "@potential-guide/objective-package-standard"
    subject: |
      {
        "root": context.repo.rootPath,
        "directory": context.path,
        "roles": ["internal"], "runtime": "universal", "allows": [],
        "entries": ["src/index.ts"], "generated": [], "joins": [], "deliveries": []
      }
```

`subject` 是直接 JSONata，不是模板对象。Unit 允许省略输入。
声明不含 target、revision 或 manifest 文件名。业务依赖使用实际包名，
调用方在明确准备边界解析 npm 来源并固定完整内容 digest，不把相对目录猜成远程来源。
`root` 为绝对 checkout 路径，`directory`、入口和配置路径为显式仓库/包相对 POSIX 路径。
绑定上下文仅包含 `context.repo`（`rootPath`、`origin`）和 `context.path`。
仓库级 subject 保留该结构；包级 subject 显式投影 root/directory，不把旧的 opaque
repository/checkout ID 冒充 origin。没有 origin 时保留 null；不伪造身份或来源证据。

角色为 npm/cli/browser/cloudflare-worker/internal/tool，可组合；runtime 为
node/browser/worker/tool/universal。`allows` 是维护者确认的内部依赖白名单，绝不从
实际依赖倒推。`entries` 是包自身入口；实际源码由 inventory/AST 导入图发现，不维护源码清单。
`generated: [{path,reason}]` 的路径相对本包，仅这些确切文件免于源码扫描；
未声明的 runtime 源码照常检查。

`joins: [{id,kind}]` 表示参与根的联合交付，根要求双方一致。包可以作为另一种交付的支撑库。
`deliveries` 表达本包拥有入口的局部交付，格式与根联合交付相同；
跨包集合、完整运行/peer 支撑闭包、服务关联应放根声明，不重复每包清单。

根 [objectives.yaml](../../objectives.yaml) 的 subject 是
`{context, policy, deliveries}`，只保留真正跨包约束。包身份与目录来自 pnpm 实际发现及
package.json，不由根清单枚举。原集中 requirements 文件及 contract/checkerModule 输入已删除；
不保留兼容加载器。`src/contract.ts` 仅是内部规则数据类型及 schema 片段，不是外部契约入口。

## 观察顺序、依赖与交接

两个 Pilot 均为 initial → structured → standardized。initial 为协议内置基线，
terminal 仅为 standardized 的目标别名，观察与证据使用实际业务 ID：

1. 根先检查声明完整性、共通配置、布局、文件职责、联合交付映射和闭包。
   可选 `policy.packageLayers` 指向仓库相对 YAML 分层政策；本仓库使用根目录
   `package-layers.yaml`。结构阶段的架构合理化检查验证所有实际 pnpm workspace 的
   protocol/business/tools 归属、暂缓外部化包及依赖方向，覆盖所有依赖字段、
   生产源码与类型导入、重导出、动态导入、CommonJS、npm/TypeScript alias 和跨包路径。
   配置缺失、损坏、未知分层、重复/遗漏归属及反向依赖均阻塞结构阶段；
   未配置此政策的消费者不强制采用三层架构。`pnpm layers:check` 复用相同 bundle，
   不保留仓库脚本内的第二套规则。
   根通过 `createSourceObjectiveDependencyProbe`（进程 IPC，宿主执行既有
   `createObjectiveDependencyProbe`/`checkObjectiveLevel`）观察每个包的具体 ID + subject，
   消费者要求 structured。包只检查自身文件、角色意图和适用配置。
2. 根交付阶段再次请求包的完整观察，要求 terminal。同轮可信只读视图下可复用完整事实，
   但仍逐调用校验来源与依赖证据、独立比较目标层级。包检查实际 package scripts、Turbo、
   依赖范围/方向/catalog、发布/CLI 元数据、已有产物、所有相关源码导入和包局部交付。
   根在依赖合格后检查跨包循环、任务图、运行时边界以及联合交付准备。

build 必需；check script 存在时要求它与 Turbo 对齐，否则要求 lint/test/typecheck 全套。
其他有适用 Turbo 定义的 scripts 也参与任务图。支持包 turbo.json 明确 `extends: ["//"]`
及本包 task overrides；未知 schema 不静默忽略。检查器不运行任何目标脚本。

缺失/损坏/错绑定声明是根 internal problem。实际低层级是统一 dependency problem，
带 objectiveId、subject、expectedLevelId、currentLevelId，并由宿主记录依赖版本证据。
来源加载/IPC/调用故障返回 error，不能伪造低层级。checks 不启动 Agent 或嵌套 regulation；
Supervisor 接收真实 dependency-required 交接，推进包后重新观察消费者。
公共声明解析/投影在 `@potential-guide/objective-pilot`，CLI 与检查器复用同一实现，
不反向依赖 CLI-core，也不导入 pguide 私有源码。

### 只读输入视图与采集分层

两个入口均由生成器提供 `observation-inputs.json`，显式声明
`bounded-readonly-filesystem-v1`：判断只依赖受限读取器中的文件事实，无目标脚本、
网络或时钟状态。CLI 宿主采集并以第二次字节遍历校验整轮视图，以 SHA-256 绑定
私有传递文件；checks 只消费并校验该视图，不向宿主提供公共事实或“已通过”结论。
所有 check 继续在独立进程按原层级顺序执行，subject 和问题归属不被替换。
完整观察结束即销毁视图与结果；修复、新 probe 和 Regulation 新轮次重新采集。
捕获后的并发目标变化在下一次观察可见，当前整轮始终判断捕获的同一视图。
捕获不稳定、不可读或超过边界时退回完整 live 检查，不启用结果复用。

包入口无宿主视图时仍可独立运行：采集 workspace/root 配置和**全部实际包 manifest**，
但 inventory 仅展开自身源码树；受支持的 pnpm pattern 前缀引导 manifest 发现，不再
为每个包递归扫描其他包源码。未知 pattern 保留全仓 fallback 与 unverified 诊断。
根检查继续采集完整 inventory，源码导入的不同语义判断均保留。
路径越界、符号链接、秘密文件及其子目录均不可读取。ignored 目录仅在输入视图契约下
拒绝显式读取；无视图/live 入口保留旧的显式文件读取行为，inventory 仍跳过这些目录。
单文件 1 MiB、
inventory 20000 文件边界不变。视图传递额外受 40000 条目与 128 MiB 总量限制。
预期捕获不可用会记录 `input-view.unavailable` evidence；`PGUIDE_TIMINGS=1` 同时输出
`input-view.capture` / `status: unavailable` 和 `reason`（必要时 `code`）。原因区分
input-changed、inventory-limit、byte-limit、unreadable；程序错误不降级为 live 检查。

架构分层的 TypeScript `extends`、glob 和 alias/module resolution 也使用同一受限视图
宿主，不再把 `ts.sys` 传入视图模式。文件/目录存在性、读取、目录枚举和 realpath 均来自
捕获事实，glob 使用所绑定 TypeScript 版本自身的匹配器；越界、链接、秘密及排除路径
显式报错，不回退目标实时 FS。无视图模式保留原 TypeScript 系统宿主与既有 options 判断。
视图模式的配置解析错误
不能留下部分 options 后静默跳过 alias 检查；实际生产源码覆盖仍由完整 inventory 决定。

全通过路径的包完整观察从每包两次变为一次：`2 + 4N` → `2 + 2N`
个检查进程；21 包为 86 → 44。失败路径次数不作此承诺，热运行也不跨 probe 保留结果。
以 `PGUIDE_TIMINGS=1` 采集准备、视图、整体观察计时；进程和文件操作插桩应同时覆盖
宿主采集及 checks，并用 PID + UUID 标识进程，避免 Windows PID 重用漏计。
同等输入、来源、Node、预算和插桩分别比较冷/热轮次；不能拿不同环境历史耗时直接比较。

## 原约束归属

| 原约束 | 现在的权威位置与验证 |
| --- | --- |
| 包角色、runtime、允许依赖、入口 | 各包 standardize subject；独立包检查及根跨运行时校验 |
| 每包源码清单 | 删除重复清单；保留入口存在性和所有实际源码的 AST 导入/边界检查 |
| build/lint/test/typecheck | 从 package scripts 与适用 Turbo 读取，包检查强制 build + check 套件 |
| npm 公开身份、exports/types/files、CLI bin/shebang、已有产物 | 独立包交付检查 |
| pnpm workspace/catalog、workspace ranges | 实际配置发现；包检查自身依赖，根检查配置与唯一身份 |
| apps/packages/docs/scripts、requiredFiles、位置例外、文件职责 | 根 policy；未知用途仍为 unverified，不擅自移动/删除 |
| standalone bundle 生成物豁免 | 所有者包的 generated 声明，精确路径与理由 |
| public-library-suite / developer-commands | 根 deliveries 保存原联合包集合、入口、runtime、目的、非独立交付意图；每包 joins 确认参与 |
| 依赖循环、任务循环/悬空引用、跨包 runtime、运行/peer 支撑闭包 | 根跨包观察 |
| 三层归属与跨层依赖方向 | 根 policy.packageLayers 引用 YAML；根结构阶段架构检查，包 allows 仍独立生效 |
| 有理由的依赖例外 | 根保留 dependencyExceptions，allowCycle 仅豁免该循环边；不再越权覆盖包自身 allows，方向例外须同时明确修改所属包意图 |
| Worker/browser/service/OIDC/migration 配置引用与独立交付要求 | 复用原 delivery adapters；包局部或根联合交付按归属验证 |

新增的 regulator/Supervisor 开发依赖仅用于真实交接集成测试，明确写入此工具包 allows；
不是根据实际依赖自动更新白名单。

Delivery 字段仍为 `id,purpose,kind,packages,entry:{package,path},runtime,resources,services,
capabilities,independent`，可选 `environment,config,output,migration:{package,entry,resource}`。
资源仅名称、kind、visibility、supply、environment，不含秘密值。根路径相对仓库；
entry.path 相对其所属包。支持 npm/cli/browser/cloudflare-worker；未知适配器阻塞为 unverified。

## 验证和消费

```powershell
pnpm monorepo:build
pnpm --filter @potential-guide/objective-monorepo-standard test
pnpm check
pguide probe --objective standardize --scope directory --format json
```

最后一条仅在声明指向的 Git 来源已含迁移提交后有效；未发布的工作树不等于远程 snapshot。
在包目录执行相同命令即可独立观察包。需要固定版本时由调用方提供完整 `--revision`，
清单本身不 pin。库入口为 `checkPackage(subject, layer?)`、
`checkRepository(subject, layer?, dependencyProbeFactory?, signal?)` 和对应严格 subject schema。
`checkPackageLayers(root, policyPath?)` 可独立返回相同架构检查报告，默认读取根
`package-layers.yaml`，供本仓库快捷命令使用。
根默认 factory 需要宿主 IPC；直接库消费者应使用既有 dependency API 提供绑定，
不能伪造观察证据。`checkMonorepo(root, contractPath)` 已移除。

`node scripts/verify-monorepo-pilot.mjs <report.json>` 在仓库 `.cache` 下建立独占 Git fixture，
提交当前生成的两个 Pilot 后使用本机构建 pguide 验证独立消费和精确 tree/source 证据；
不会提交当前工作树或使用旧 upstream 冒充新版本。测试还独立调用真实仓库的十二个包。

检查范围是静态交付准备，不执行 build/pack/install/publish/deploy/migration、读取秘密值、
探测线上身份或资源。缺失已有产物、未知配置、无法解析的导入均阻塞；terminal 不代表线上可用。
pnpm pattern 支持 literal、`*`、`**` 和 `!`；更复杂 pattern 明确未验证。
扫描跳过 dist、node_modules、.git、.cache 等，不沿符号链接越界。
