# Probe 作者 YAML、资源推导与两阶段构建

本文服务于 [Idea](Idea.md)，补充 [成品结构](Objective-format.md)。
所有 Probe API 名称是候选；已存在的是 Check 准备器和通用 Task 编译器。
业务定义仍称 Objective，作者入口和执行制品按动作命名为 Probe。

## 与 Check 相同的两阶段

```text
Check:
  <kind>.check.build.yaml
    → prepareCheck
    → 固化源文件/definitions/resources + task.build.yaml
    → buildTask
    → task.yaml + worker.cjs + schemas + resources → CAR/CID
    → verifyCheckResources → 接受成品

Probe:
  <kind>.probe.build.yaml
    → prepareProbe
    → 固化源文件/definitions/resources/Check 子树 + task.build.yaml
    → 同一个 buildTask
    → task.yaml + worker.cjs + schemas + resources → CAR/CID
    → verifyProbeResources → 接受成品
```

第一阶段是业务准备，不编译 Worker、不自行生成最终 CAR，也不调用另一套 Bundle 编译器。
第二阶段是通用 Task 编译，不查询 publication，不重新选择 Check 版本。
成品验证是接受门槛，不是第三套编译流程。上传与 pin 是独立外部操作。

## 作者 probe.build.yaml 候选

目标作者格式与简化后的 Check 一样使用
`name/kind/source/languages/referenceRoot`，额外资源可选使用 `resources/binary`。
Probe 专属新增 `bundles/checks/levels`，没有额外 `objective` 包装层。
作者不声明逐页 `references`、展开的嵌入文件集或最终 `include`；
这些由第一阶段推导并固化，不能误删成品中的显式索引和清单。

```yaml
name: Development Environment
kind: development-environment
source:
  root: src
  entry: src/main.ts
  contract: src/contract.ts
languages: [en]

bundles:
  tools:
    source:
      kind: publication
      url: https://example.test/publications/environment-tools-check

checks:
  tools:
    bundle: tools
    inputMapping: environment
  project-tools:
    bundle: tools
    inputMapping: project

levels:
  - id: prepare-environment
    checks: [tools]
  - id: prepare-project-tools
    checks: [project-tools]

referenceRoot: references
```

上例完整展示不带额外资源的作者格式。需要额外图片或数据时才添加：

```yaml
resources:
  - from: assets/environment.svg
    to: resources/assets/environment.svg
binary: []
```

`resources` 不是全部资源清单，只声明不能由业务结构推导的附加文件；
`binary` 是附加的字节处理规则，不是文件发现入口。没有它们时使用空选择，
但业务推导出的文档、定义与 Check 内容仍必须全部进入成品。

`example.test` 是 publication 占位，不代表已验证的 Pinboard API。
也可以用精确根 CID 替换来源对象：

```yaml
source:
  kind: ipfs
  cid: <Check-root-CID>
```

作者不需要本地 IPFS 节点或预存子 Bundle；准备器必须获取并验证全部内容，
仅解析到 CID 不足以提供自包含构建输入。

### 源文件与契约

`source.root/entry/contract` 与 Check 同义：准备器快照 root 内源文件，
entry/contract 必须在该源集合中，路径以作者 YAML 所在目录为基准。
entry 使用 Task SDK 的 `runTask` 启动 Probe 业务回调；
通用阶段把它连同业务依赖编译成唯一 `worker.cjs`。

作者 contract 用 TypeBox 定义一次 `input`，并通过 Probe 契约工厂生成 result/message。
`environment` 与 `project` 两个字段各自满足 tools Check 的 `{checkTimeoutMs,tools}` 输入；
不能套用旧示意里的 `{root,kind}`。
准备器从 YAML/已验证子 Check 生成语言、实际阶段（含 terminal）及按逻辑引用归属的
Problem codes 等 definitions，供 contract 与 Worker 同源使用。
`initial` 是别名，不作为结果 union 的真实状态。
Probe 契约/回调工厂的候选命名为 `createProbeContract` / `createProbeTask`，
不是已存在的 API，具体签名留待实施。

与 Check 一样，输入契约最终成为 `task.yaml.inputSchema`；
作者 YAML 不重复手写 `inputSchema/subjectSchema/resultSchema/messageSchema`。
生成 definitions 发生在 TypeScript 检查与通用编译之前，不修改历史 Check 的 definitions。

## 第一阶段：prepareProbe

1. 验证 YAML、阶段/绑定关系与规范路径；从 `languages/levels` 推导必需页面，
   快照作者源文件和显式附加资源。
2. 对每个来源解析一次：固定发布版本及 Check 根 CID，获取完整 DAG，
   验证块哈希、Task/Check 契约、完整资源与语言/Problem 元数据。
3. 在受限 Reference 目录中发现合法稀疏 Override，验证必需页、frontmatter
   与全部语言的有效覆盖，生成唯一的
   `resources/objective.json`、规范页面路径和 definitions。
4. 将原 Check 放入准备的 `resources/checks/<binding>/` 内容集合；
   保留已验证块/根身份与子清单，生成通用 `task.build.yaml`。

准备结果组织为：

```text
dist/
├─ definitions/<kind>.js
├─ definitions/<kind>.d.ts
└─ staging/<kind>/
   ├─ task.build.yaml
   ├─ src/…
   ├─ dist/definitions/<kind>.{js,d.ts}
   └─ resources/
      ├─ objective.json
      ├─ references/…
      ├─ assets/…                   # 仅在显式选择附加资源时存在
      └─ checks/<binding>/…          # 完整已验证 Check 内容
```

引用的 CID、元数据与实际子树必须一致；准备后的源和内容是固定快照，
后续不能重新打开可变作者来源或查询 publication 代替这些输入。
作者来源、锁记录与接受凭据可以在成品外保留，不把 credential 写入成品。

生成的通用 YAML 使用既有字段；下例显示普通文件输入部分，`include` 是准备器
根据完整资源集合生成的映射，示意中使用通用工具已支持的 glob 简写。
实际输出沿 Check 的精确资源映射做法，不让作者手写或维护展开列表。

```yaml
$schema: https://shazhou-ww.github.io/potential-guide/schemas/artifacts/task-build/v1.json
name: Development Environment
runtime:
  minVersion: "22.13.0"
source:
  entry: src/main.ts
  contract: src/contract.ts
  mode: explicit
include:
  - from: resources/**/*
    to: resources/
outDirectory: bundle
binary: []
```

`binary: []` 仅代表本例父子资源都为文本；一般情况由自有 binary 选择与
子 Bundle 精确 binary 加前缀合成，不能漏掉子二进制文件。
现有文件接口不等于已支持原 DAG 接枝；如需要额外通用子树输入，
必须显式定义并测试该扩展，不能把它隐藏在未支持的 YAML 字段中。

## 第二阶段：buildTask 与接受验证

通用编译器从准备好的 contract 生成 Schema，从 entry 生成 Worker，
生成唯一 `task.yaml`，完整 include/binary，执行通用文本规范化并导出 UnixFS CAR。
不要求 Engine 理解 Objective 元数据，也不生成独立 `objective.yaml`。

业务接受器先使用通用 `readTaskArtifact` 验证整个成品，再验证：

- 实际自有资源集与已准备快照匹配，业务 JSON、页面和 binary 列表没有遗漏或额外内容。
- 父 include 覆盖全部文件；每个子 Bundle 的 include/binary 相对其自身根仍然有效。
- 每个实际子树根等于第一阶段固定的 Check CID，内容没有被重编译、规范化或替换。
- 父根涵盖所有子树的完整 DAG，Result Schema/definitions 与阶段、语言、Problem 元数据一致。

仅复制文件后用另一组 UnixFS 参数导入可能改变子 CID；
不能以文件字节相同替代上述子树验证。
现有通用编译器主要接收文件并重新构树；在适用的规范布局下须证明其子 CID 保持，
不适用时明确失败，或扩展通用编译/内容层接受已验证子树。
无论采用哪种实现，仍保留两阶段与同一个通用编译入口，不复制 Objective 专用打包后门。

全部检查通过才替换已接受成品/索引和锁记录；
准备失败、编译失败或验证失败都不能破坏上次接受的输出。

## 根据业务结构推导资源

`referenceRoot` 相对于 Build YAML 所在目录；页面路径由它、语言和业务 ID 唯一推导。
作者不再维护映射。准备器只遍历这个受限目录验证允许的页面，不扫描整个作者工程，
不解析 Markdown 的任意链接来隐式收集依赖。

| 内容 | 由什么推导 | 缺失或异常处理 |
| --- | --- | --- |
| Objective 概述 | 每个语言的 `objective.md` | 必需，缺失失败。 |
| 阶段页面 | `levels[].id` → `levels/<id>.md` | 每个语言都必需，缺失失败。 |
| 完成页面 | 固定 `levels/terminal.md` | 每个语言都必需；不为 initial 建页。 |
| 原 Check 内容 | `levels → checks → bundles` 的引用闭包及来源 | 依赖绑定、来源、输入映射仍显式声明；内容必须完整可验证。 |
| Check 概述 Override | `checks/<ref>/check.md` | 允许不存在，存在则验证并收录。 |
| Problem Override | `checks/<ref>/problems/<code>.md`，code 来自已验证子 Check | 允许不存在，未知 ref/code 或非法文件失败。 |
| 附加图片/数据 | 可选 `resources: [{from,to}]` | 不从 levels/Markdown 猜测；显式选择的文件缺失失败。 |

例如上述作者 YAML 配合下面的 Reference 文件，生成
[成品描述](Objective-format.md)中的逐语言 `references` 索引：

```text
references/en/
├─ objective.md
├─ levels/
│  ├─ prepare-environment.md
│  ├─ prepare-project-tools.md
│  └─ terminal.md
└─ checks/tools/
   ├─ check.md
   └─ problems/tool-missing.md
```

构建前没有某个可选 Override 文件，表示继承子 Check 的同语言文档。
已发现文件读取失败、非法 frontmatter 或快照后文件/块缺失都必须失败，
不能当作“不存在 Override”处理。未知语言、路径和 Problem 必须报错，
不能通过忽略拼错的文件名使构建成功。
没有显式映射后，工具无法识别“作者忘记创建一个本来想覆盖的页面”；
未提供的合法可选路径就按继承解释，不推断作者意图。

### Check 作者配置同步简化

当前 Check 工具仍要求显式 `references` 并校验路径恰好等于约定值。
本 idea 的实施范围包括移除这一重复作者字段并同步仓库作者配置、Schema、测试和文档；
不能只让 Probe 简化、Check 长期维持另一套作者规则。

新的 Check 作者配置示例：

```yaml
name: Nonempty text check
kind: text
source:
  root: src
  entry: src/main.ts
  contract: src/contract.ts
languages: [en]
problemCodes: [text-empty]
referenceRoot: references
```

准备器从语言与 `problemCodes` 要求 `references/en/check.md` 和
`references/en/problems/text-empty.md`，不需要逐页列表。
零 Problem codes 仍要求 Check 概述，但不要求 Problem 页。
Check 生成的 `resources/check.json.references` 与现有规范保持一致；
不因此改变结果协议、历史 Bundle 或 consumer-side 验证。

作者格式是显式迁移：仓库例子统一删除冗余字段，更新后的作者 Schema 拒绝旧字段，
不引入“有时按映射、有时按目录”的隐式双模式。已发布不可变 Bundle 不受影响；
同样的源、页面与固定编译环境下应证明去掉冗余配置不改变生成资源内容。

### 共同的路径与资源约束

- 页面严格按 `<referenceRoot>/<language>/<suffix>` 推导，成品为
  `resources/references/<language>/<suffix>`；suffix 由相应业务类型定义。
- 拒绝未知页面、非法语言、越界、链接、特殊文件和大小写/路径冲突；
  assets 位于 referenceRoot 外，通过 `resources` 显式选择。
- `resources: [{from,to}]` 是与 Check 一致的精确映射，不使用 glob，to 在 resources 下。
  `binary` 才使用最终路径 portable glob；它不能覆盖 generated objective.json，
    也不能选取 `resources/checks/` 子内容。子 binary 只能从子契约自动派生。
- 普通资源不能覆盖生成的页面、业务 JSON、Schema、Worker 或子树。
  作者路径不使用 `./`、`..`、绝对路径或反斜线。
- 自有非二进制文件验证 UTF-8 并只将 CRLF/孤立 CR 转 LF，保留其余字节；
  binary 保留原字节，Reference 仍必须通过文本与 frontmatter 验证。
  子 Bundle 只验证，不重新改写。

## Publication、锁定与可复现

Pinboard 是预期的可变选择入口，需要按真实 API 证明发布版本对应完整 Check 根，
不能把页面地址、附件 CID 或 CAR 文件 CID 当作 Bundle 根。
构建后的消费者不查询该入口；版本变化不会改变既有 Probe Task Bundle。

建议记录 `来源 → 确定发布版本（如有） → 已验证根 CID`。
更新模式重新解析并生成候选锁，锁定模式只接受匹配当前作者声明的精确记录；
内容缺失时失败，不回退到 latest。同一次准备中同一来源只解析一次。

可复现需同时固定作者源快照、子 Check、构建工具链与 UnixFS 策略，
不只是固定 publication 或 YAML。父 CID 和构建凭据保存在根外，避免自引用。
消费者只需要最终 Bundle；不需要作者工程、锁文件、publication 或现场构建。
