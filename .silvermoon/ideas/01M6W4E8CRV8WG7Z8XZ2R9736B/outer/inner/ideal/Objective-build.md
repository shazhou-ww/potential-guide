# Objective 作者 YAML 与两阶段构建

本文服务于 [Idea](Idea.md)，补充 [成品结构](Objective-format.md)。
所有 Objective API 名称是候选；已存在的是 Check 准备器和通用 Task 编译器。

## 与 Check 相同的两阶段

```text
Check:
  <kind>.check.build.yaml
    → prepareCheck
    → 固化源文件/definitions/resources + task.build.yaml
    → buildTask
    → task.yaml + worker.cjs + schemas + resources → CAR/CID
    → verifyCheckResources → 接受成品

Objective:
  <kind>.objective.build.yaml
    → prepareObjective
    → 固化源文件/definitions/resources/Check 子树 + task.build.yaml
    → 同一个 buildTask
    → task.yaml + worker.cjs + schemas + resources → CAR/CID
    → verifyObjectiveResources → 接受成品
```

第一阶段是业务准备，不编译 Worker、不自行生成最终 CAR，也不调用另一套 Bundle 编译器。
第二阶段是通用 Task 编译，不查询 publication，不重新选择 Check 版本。
成品验证是接受门槛，不是第三套编译流程。上传与 pin 是独立外部操作。

## 作者 objective.build.yaml 候选

字段平铺，与 Check 一样使用 `name/kind/source/languages/referenceRoot/references/resources/binary`。
Objective 专属新增 `bundles/checks/levels`；没有额外 `objective` 包装层。

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
references:
  en:
    objective: references/en/objective.md
    levels:
      prepare-environment: references/en/levels/prepare-environment.md
      prepare-project-tools: references/en/levels/prepare-project-tools.md
      terminal: references/en/levels/terminal.md
    checks:
      tools:
        check: references/en/checks/tools/check.md
        problems:
          tool-missing: references/en/checks/tools/problems/tool-missing.md

resources:
  - from: assets/environment.svg
    to: resources/assets/environment.svg
binary: []
```

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

## 第一阶段：prepareObjective

1. 验证 YAML、阶段/绑定关系、规范路径与 Reference frontmatter，快照作者源文件和自有资源。
2. 对每个来源解析一次：固定发布版本及 Check 根 CID，获取完整 DAG，
   验证块哈希、Task/Check 契约、完整资源与语言/Problem 元数据。
3. 验证稀疏 Override 与所有声明语言的有效页面覆盖，生成唯一的
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
      ├─ assets/…
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

## 作者路径与资源一致性

- `referenceRoot` 和 Reference 映射都以 Build YAML 所在目录为基准。
  `referenceRoot: references` 时映射必须是 `references/en/objective.md`，
  不是 `objective.md`，也不是相对 referenceRoot 再解析一次。
- 页面严格按 `<referenceRoot>/<language>/<suffix>` 选择，suffix 为
  `objective.md`、`levels/<id>.md`、`checks/<ref>/check.md` 或
  `checks/<ref>/problems/<code>.md`；成品统一为 `resources/references/<language>/…`。
- 拒绝未知/未选择的 Reference 文件、重复映射、非法语言、越界与符号链接。
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
构建后的消费者不查询该入口；版本变化不会改变既有 Objective。

建议记录 `来源 → 确定发布版本（如有） → 已验证根 CID`。
更新模式重新解析并生成候选锁，锁定模式只接受匹配当前作者声明的精确记录；
内容缺失时失败，不回退到 latest。同一次准备中同一来源只解析一次。

可复现需同时固定作者源快照、子 Check、构建工具链与 UnixFS 策略，
不只是固定 publication 或 YAML。父 CID 和构建凭据保存在根外，避免自引用。
消费者只需要最终 Bundle；不需要作者工程、锁文件、publication 或现场构建。
