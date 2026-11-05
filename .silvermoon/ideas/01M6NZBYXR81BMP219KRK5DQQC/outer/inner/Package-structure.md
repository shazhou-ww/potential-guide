# Check 分包结构草案

本文是 [实施契约](./Implementation.md) 的设计说明，尚未实现；不新增独立验收契约。

## 两个源码包，三个执行制品

| 包 | 定位 | 交付 |
| --- | --- | --- |
| `@potential-guide/check-sdk`（新增名称） | 新架构 Check 的公共作者库 | 可复用的类型、契约、回调适配及公共 Reference 文档，不生成自己的 Task Bundle |
| `@potential-guide/check-environment`（保留） | 工具版本、目录和网络检查 | 库 API，以及各自带有 Reference 文档的 tools、directories、network 三个独立 Task Bundle |

不把环境检查拆成三个 npm 包。每个 Bundle 有独立输入契约、入口、CAR 和 CID，能单独提交给 Task Engine；源码与测试仍由一个环境检查包维护。这里的共享包面向 Task Engine 作者，不是旧 `check-task` 的改名。

## 新增 `check-sdk` 包

建议目录为 `packages/check-sdk/`，名称确定为 `@potential-guide/check-sdk`，本次不涉及 npm 名称可用性核验或发布。

包含四类职责：

1. **统一结果契约**：导出 `CheckProblem`、`CheckResult` 和对应 TypeBox Schema，类型从 Schema 推导；提供 `createCheckContract(inputSchema)`，组合业务输入、公共结果和不接受业务消息的契约。
2. **统一结果组装**：提供问题列表到结果的转换。空列表返回 `{pass:true}`；非空列表返回 `{pass:false,problems}`，不输出通过项。
3. **回调适配**：提供 `createCheckTask(check)`，将返回问题列表的业务函数转换为可传给 `runTask` 的回调，保留输入类型推导与 Task Context，执行前后检查取消。
4. **作者侧转换与文档校验**：由 `@potential-guide/check-sdk/authoring` 从 Check Build YAML 出发校验语言、定义页与问题页，生成标准 Task Build YAML 及其完整输入。环境检查和后续检查的构建必须使用此门禁；它不实现第二套 Bundle 编译器。

工具归属已确认：保留在 Check SDK 内，使用独立子路径，不另拆校验工具包。

| 导出入口 | 职责与使用位置 |
| --- | --- |
| `@potential-guide/check-sdk` | 结果组装、`createCheckTask`，供库和 Worker 回调使用 |
| `@potential-guide/check-sdk/contracts` | 公共 Schema、类型和 Check 声明，供作者契约使用 |
| `@potential-guide/check-sdk/authoring` | Check YAML 校验、资源准备和标准 Task 作者输入生成，仅供作者构建使用 |

根入口不重导出作者校验器或 Schema 构建实现。源码与构建产物均验证运行时导入隔离，避免文件扫描、Markdown 解析等作者侧代码进入 Worker；通用 `task-sdk`、Task Engine 和 `task-bundle` 不承担 Check 专属规则。

公共 Reference 随共享包维护，供新检查作者引用；README 只做入口，不代替完整契约说明：

```text
packages/check-sdk/
  src/
    index.ts               结果组装和回调适配
    contracts.ts           公共 Schema、类型和 Check 声明
    authoring.ts           Check 到 Task 的作者侧转换与校验入口
  references/
    check-result.md        字段语义、通过/不通过示例和兼容规则
    check-callback.md      回调约定、执行故障、取消、日志与清理边界
  README.md                作者入口与 Reference 索引
```

这些是共享包的作者文档，不自动成为每个 Bundle 的资源；具体检查不得把自己的问题码解释放到共享包里。实施时确保共享包的打包清单包含这些文档，避免仓库中可读、包安装后缺失。

沿用现有结果，不另加外层包装：

```ts
type CheckProblem = { target: string; code: string; actual: string | null };
type CheckResult = { pass: true } | { pass: false; problems: CheckProblem[] };
```

上面是形状示意；实际 Schema 要求失败列表非空、通过结果不含 `problems`，拒绝额外字段，并保留现有字段约束。

拟议用法如下，API 尚未实现：

```ts
// contract.ts
export default createCheckContract(toolsInputSchema);

// main.ts
runTask(createCheckTask(inspectTools));
```

`inspectTools(input, context)` 只返回实际问题列表。现有 `checkTools` 库函数继续通过同一个公共结果组装函数返回 `CheckResult`，不能破坏 Objective 消费者。

**不包含**工具执行、目录探测、DNS/HTTP 算法，也不负责超时策略、子进程清理、调度、Bundle 编译或 Pinboard 发布。执行异常继续抛出，取消继续传播，不能转为 `pass:false`；日志使用 `context.log`，具体资源由业务实现清理。`runTask` 仍由作者入口显式调用，不由共享包暗中启动。

依赖方向是环境检查 → Check SDK → 通用 Task SDK；Check SDK 的契约使用 TypeBox，不依赖环境检查或旧 Check 制品/Host 包。第一阶段输出标准 Task 作者文件，由外层薄编排调用 Task Bundle 工具，Check SDK 不内嵌其编译器。纯契约与回调入口应分离，避免运行时代码因导入结果工具而携带作者侧 Schema 构建依赖。通用 Task SDK 不反向依赖 Check SDK。

## 环境检查包：当前结构

实际源码位于 [check-environment](../../../../../packages/check-environment/README.md)：

```text
packages/check-environment/
  build.mjs                 手写声明，调用低层 buildTaskBundle
  src/
    contracts.ts            三种输入和公共结果的 JSON Schema
    result.ts               公共结果类型、组装及环境检查辅助函数
    tools.ts                工具版本检查
    directories.ts          目录检查、写入探测
    network.ts              DNS 和 HTTP 检查
    command.ts              有界命令执行与清理
    index.ts                现有库导出
  test/
    checks.test.ts           库行为测试
    bundle.test.ts           三种 Bundle 的 Engine 集成测试
```

另有包声明、TypeScript 配置、README、许可证和 Objective 声明。当前输出为 `dist/bundles/<kind>/`、对应 CAR 及 `references.json`。

## 环境检查包：迁移后结构

作者维护三份 Check Build YAML，生成的 Task Build YAML 不作为源码维护。所有中间与最终产物都在包内 `dist/`，作者源码与 Reference 原文留在源目录：

```text
packages/check-environment/
  tools.check.build.yaml
  directories.check.build.yaml
  network.check.build.yaml
  references/
    tools/<language>/
      check.md              工具检查用途、输入、结果与环境前提
      problems/*.md         该语言下每个稳定问题码的解释
    directories/<language>/
      check.md
      problems/*.md
    network/<language>/
      check.md
      problems/*.md
  src/
    tasks/
      tools/{contract.ts,main.ts}
      directories/{contract.ts,main.ts}
      network/{contract.ts,main.ts}
    tools.ts
    directories.ts
    network.ts
    command.ts
    result.ts               仅保留环境专属辅助逻辑或兼容导出
    index.ts                保留现有库 API
  test/
    checks.test.ts
    bundle.test.ts
```

每份 `contract.ts` 定义各自输入并使用公共 Check 契约；`main.ts` 显式调用 `runTask(createCheckTask(...))`。原 `contracts.ts` 的公共结果定义移到 Check SDK，业务输入迁到各 Task 契约，测试跟随更新，避免维护两份 Schema。

先实际运行 `task-bundle init` 核对标准入口模板与契约，再让第一阶段生成等价的 Task 作者输入。完整构建链为：

```text
Check Build YAML + 源码 + Reference
  -> check-sdk/authoring 校验与转换
  -> dist/staging/<kind>/task.build.yaml + src + resources
  -> 标准 task-bundle build
  -> dist/staging/<kind>/bundle/ 与 bundle.car
  -> 接受有效候选
  -> dist/bundles/<kind>/ 与 <kind>.car
```

对应的产物布局为：

```text
dist/
  staging/
    tools/
      task.build.yaml
      src/                 生成入口、契约与所需源码闭包
      resources/           已校验的索引与 Reference
      bundle/              第二阶段候选目录
      bundle.car
    directories/           同样的阶段布局
    network/
  bundles/
    tools/
    tools.car
    directories/
    directories.car
    network/
    network.car
  references.json          只记录已接受的最终 CID
```

生成配置使用 `outDirectory: bundle`，使源与输出都在该配置的构建根内，不用 `../../bundles` 逃出构建根。验收后的目录与 CAR 由薄编排搬移到最终位置，内容不变，CID 不变。临时文件、生成类型、索引、构建配置和 CAR 均不得写到源码目录或仓库根的 `dist.car`；作者不手改 staging，clean 可重新生成全部产物。

第二阶段只消费第一阶段准备并验证过的业务源码与资源，不重新选择原始 Reference 或读取未固定的业务输入；准备所需源码闭包并保留可解析的锁定依赖，不能只复制入口而遗漏相对导入。资源选择在第一阶段展开成确定集合，第二阶段选中的文件集合必须一致。现有 `build.mjs` 如保留，只编排两阶段、候选接受和最终索引，不复制业务校验器或通用 Bundle 编译规则。库的 TypeScript 编译仍保留。

共享包代码在作者构建时打入各 Worker，Engine 不安装这两个 npm 包。部署阶段用 `pinboard import` 发布三个 CAR，核对原 CID，并在独立消费环境验证执行；不是把源码目录作为执行制品上传。

## Reference 归属与随制品交付

Reference 是检查内容的一部分，不是某次执行的日志或结果，也不能只留在 npm README 中：

- **公共约定**由 Check SDK 的 `references/` 维护，解释结果与回调契约。
- **检查知识**由环境检查包各自的 `references/<kind>/<language>/` 维护。`check.md` 解释用途、输入与结果、适用前提和限制；`problems/<code>.md` 解释问题含义、`target`/`actual` 的语义、排查及建议处理方式，不执行修复。
- 工具检查覆盖 `tool-missing`、`tool-unusable`、`version-unparseable`、`tool-version`；目录检查覆盖 `not-directory`、`directory-unusable`；网络检查覆盖 `dns-unavailable`、`http-status`、`http-unavailable`。超时、启动或清理故障等仍按执行故障说明，不伪造新的业务问题码。

第一阶段从 Check YAML 的语义映射准备资源，生成 Task Build YAML 的标准 `include`；不恢复旧 Check manifest 格式。原文路径例如 `references/tools/<language>/check.md`，准备后位于 staging 的 `resources/references/<language>/check.md`。生成配置使用明确文件选择，例如：

```yaml
include:
  - from: resources/references/zh-CN/check.md
    to: resources/references/zh-CN/
```

这是单页示意，完整配置逐一列出全部已校验页面；例如问题页使用 `to: resources/references/<language>/problems/`，确保成品保留语言层级。不使用二次扩大文件集合的宽泛 glob。每个 Check 只选择自己的文档，工具 Bundle 的成品为：

```text
dist/bundles/tools/
  task.yaml
  worker.cjs
  schemas/                 构建器生成的契约
  resources/
    references/
      <language>/
        check.md
        problems/
          tool-missing.md
          tool-unusable.md
          version-unparseable.md
          tool-version.md
```

文档路径与问题码的对应先采用上述稳定约定：结合实际 Run 的 Bundle CID，通过 `ipfs://<CID>/resources/references/<language>/check.md` 和 `ipfs://<CID>/resources/references/<language>/problems/<code>.md` 读取。这里是 Check 层的交付约定，不是 Engine 自动解析或展示 Reference 的现成功能，也不增加结果字段。

文档和代码共同进入 CAR 的完整文件清单与根 CID，因此 Reference 内容修改也会产生新 CID。检查文档之间使用能在制品内解析的相对链接，不依赖作者 checkout 或浮动远程页面。

迁移测试除执行检查外，还应核对三个 CAR 各自包含说明页、所有可返回问题码均有对应文件，且没有误打入其他检查的文档。Pinboard 独立消费验证应读取实际 CID 下的文档，不能仅证明源码目录里存在文件。构建检查文件名、路径、存在性以及既有 Reference frontmatter，不解析文档章节、正文或正文链接。

### Reference frontmatter

“只检查文件名”是对正文检查范围的收窄，不取消 Reference 已有的元数据契约。每篇 Reference 仍以 YAML frontmatter 开头，例如：

```markdown
---
title: 工具版本不满足要求
description: 解释 tool-version 问题的含义与处理建议。
---

正文按作者需要组织，不强制章节结构。
```

仓库现有 [Reference 解析](../../../../../packages/pilot-protocol/src/resources.ts) 要求非空的 `title` 和 `description`，后者最多 200 个 Unicode code points。新 Check 保留这两个字段及其约束，但不沿用旧解析器的可选 `references` 字段；frontmatter 只接受 `title`、`description`。第一阶段检查 YAML 语法、字段和约束，缺失 frontmatter、缺必填字段、字段类型错误或未知字段等应明确失败；SDK 公共 Reference 与具体 Check Reference 使用一致规则。

文章之间的引用统一写在 Markdown 正文中，可使用普通链接或 reference-style links，Bundle 内文档优先使用相对路径。不再另维护 frontmatter 引用清单、页面引用 ID 或引用关系图，构建也不解析正文链接。语言与问题码仍由 Check Build YAML 和路径唯一确定；资源索引仍用于定位实际交付文件，不承担文章引用关系。这仅调整新 Check 的设计，不修改旧 Objective Reference 协议或其解析器，也不引入 Pilot 运行时依赖。

## 构建硬门禁：声明与文档完整性

每个 Check 的 Build YAML 是唯一作者声明，显式列出 Check 身份、业务入口、输入契约来源、支持语言、稳定问题码，以及定义页、问题页和其他资源的语义映射。它有独立的 Check 构建 Schema；TypeBox 输入契约仍由所指向的源码定义，不在 YAML 重复维护。生成的机器索引使用 Bundle 内相对路径，随资源进入 CAR，消费者无需原始工程即可导航。不给通用 Task 声明添加未经支持的字段。

这份声明是唯一事实源：结果 Schema 的 `code` 枚举、业务返回问题码的类型约束和文档覆盖矩阵从同一份问题码定义派生。不能另维护一份仅用于文档的代码清单，也不能声称扫描源码字符串就能证明所有运行路径已覆盖。运行时对未声明问题码明确报错，不把它当作正常检查结果。

| 门禁 | 必须满足 |
| --- | --- |
| 语言声明 | 语言列表非空，使用规范化 BCP 47 标记，拒绝重复或规范化后冲突；只声明实际完整交付的语言，不预设必须中英双语 |
| Check 自身定义 | 每个声明语言都存在命名为 `check.md` 的文档文件，不检查章节或正文 |
| 问题覆盖 | 对每个声明语言，所有已声明问题码都有对应的 `problems/<code>.md` 文件；零问题码的 Check 仍必须有定义页 |
| Reference 元数据 | 每篇 Reference 有合法 YAML frontmatter，只接受必填 title、description 并满足既有约束；不保留 references 字段，不检查正文 |
| 全部文档一致性 | 检查声明与实际文件名、路径和存在性是否一致，拒绝未知语言、未知问题码、重复映射和越界路径；不自动使用其他语言补缺，不解析正文、正文链接或锚点 |
| 最终制品 | CAR 的实际文件清单包含上述全部文档；源码齐全但 include 漏选也必须失败，文档与声明索引一起受根 CID 覆盖 |

共享包自身的公共 Reference 也按它声明的语言和必需页面检查。具体 Check 的完备条件是“支持语言 ×（Check 定义页 + 全部问题页）”；不要求复制共享包全部作者文档到每个业务 Bundle。

语言标签与目录一致不等于翻译正确。构建证明文件命名、覆盖和 frontmatter 合规；没有正文、缺章节、正文坏链接、翻译与解释质量均不作为本次自动检查项，交由内容审阅。完全空文件因缺少 frontmatter 而失败，不是因为正文长度门禁。

构建链应为“第一阶段校验 Check YAML 与全部资源并准备 dist 输入 → 第二阶段标准 Task Bundle 构建 → 接受为可发布制品”。语言目录、问题页和定义页的命名、覆盖及 frontmatter 检查在第一阶段完成；第二阶段只负责通用契约、文件清单、内容身份和 CAR 完整性，不重复解释 Check 文档规则。测试额外核对最终 CAR 与第一阶段已验证的资源集合和字节一致。任一失败必须以非零状态退出，业务校验报告 Check、语言、问题码和具体路径；不得静默跳过、补默认页或发布未校验的 CAR。失败候选不更新成功引用，已有有效制品不因失败被覆盖；实施时验证临时输出与接受步骤的这一边界。

通用 `task-bundle build` 继续只负责通用 Bundle，不识别 Check 规则。实施时在共享包作者入口落实第一阶段，由包构建薄编排调用第二阶段；不增加通用构建器的 Check 插件，不引入 Check 专属 JavaScript 编译器，也不把文档检查塞进 `runTask` 或 Engine。

至少加入以下负例：声明语言缺定义文件、某语言缺一个问题文件、文件名与问题码不符、未知语言或问题码、缺失或非法 frontmatter、元数据缺必填字段或包含 references 等未知字段、源码有文档但 CAR 漏选。每种情况都必须使完整构建失败；完整的单语言、多语言及零问题码声明应通过。合法 frontmatter 配合空正文、任意章节或损坏的正文链接，不得仅因正文内容被构建拒绝。
