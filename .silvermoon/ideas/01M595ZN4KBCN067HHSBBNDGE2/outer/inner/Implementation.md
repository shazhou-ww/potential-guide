# Implementation

检查边界以 [Idea](./ideal/Idea.md) 及其[检查范围](./ideal/checks.md)为准。
实现入口为[可复用检查器](../../../../../packages/monorepo-objective/src/index.ts)、
[严格需求 schema](../../../../../packages/monorepo-objective/src/contract.ts)和
[Pilot Objective](../../../../../objectives/pnpm-monorepo/README.md)；这是私有开发工具，
不增加 npm 发布包或 Silvermoon 依赖，不更改现有公共 API。

## Steps

### I-S01: 定义需求契约与结构规则

沿用现有 Objective 规范，确定结构化描述的 schema、workspace 映射与默认结构规则的覆盖方式；明确目录允许内容、必要文件、归位规则及合法例外，提供最小示例，避免与现有工具配置重复维护。

采用严格 JSON `schemaVersion:1` 需求契约；规则来源为 `pnpm-default-v1`，允许有理由的目录覆盖、
文件职责声明、固定位置/生成内容例外与依赖方向例外。交付物和 workspace 是多对多映射；
一个包可组合角色。全局技术配置当前支持 package 元数据、pnpm workspace/catalog 与 Turbo
任务 schema 子集；未知配置字段和不支持的 pattern 显式未验证，不声称检查其他工具的完整 schema。

### I-S02: 实现两层检查与类型细化

先验证结构与全局契约，再按需求和关联包验证依赖、构建与交付准备；覆盖公共库、CLI、浏览器前端、Cloudflare Worker 和内部包，显式报告未支持类型。

第一层失败或待分类会阻止第二层。第二层组合 npm/CLI/browser/Worker/internal/tool 角色，
检查运行与开发/peer 等依赖方向、循环、catalog/workspace 引用、公开入口、静态导入、
任务图与构建输出；类型专属检查观察现有产物而不运行 scripts。
通过 TypeScript 语法树读取导入，避免把注释和普通字符串当作跨包引用。
前端与服务可以合包并通过不同交付入口关联；不要求支撑包独立交付。

沿用 Pilot 的 manifest、References、process probe 和 Envelope 协议，只有结构已确认才进入
交付层。Git probe 临时 checkout 不自动构建依赖，故 subject 显式引用控制机可信、同 revision
构建的 `checkerModule`；不得由不可信目标选择执行模块，缺少该入口返回明确调用失败。

### I-S03: 验证诊断与使用边界

增加正反例测试及使用文档，覆盖多包需求、多角色包、悬空引用、依赖违规、部署配置错配与证据不足；包含错放文件的归位建议、合法例外、未知用途与目标冲突，说明检查与修复、配置验证与线上验证的区别。

测试分为[检查器 fixture](../../../../../packages/monorepo-objective/test/checker.test.ts)、
[导入语法测试](../../../../../packages/monorepo-objective/test/imports.test.ts)及
[真实进程 probe 集成](../../../../../scripts/monorepo-objective.test.mjs)。提供
[本仓库多包需求示例](../../../../../objectives/pnpm-monorepo/examples/repository.json)，
不从仓库结构自动推断需求。执行命令、结果和基线差异保存在[实施证据](./verification.md)。

## Acceptance criteria

### I-AC01: 第一层准确识别结构与契约问题

由 fixture 测试证明 layout、必要文件、schema、workspace 映射和覆盖问题均有可定位诊断；错放文件能得到有规则依据的目标目录建议与引用维护提示，合法例外不误报，未知用途不被武断归类或删除；关键契约无效时第二层不被误判为通过。

### I-AC02: 第二层按需求应用类型规则

由各类型正反例证明通用依赖与交付规则适用正确，支持多角色组合与多包关联；内部包不被强制发布，未支持类型和不足证据不返回成功。

### I-AC03: 检查可复现且保持观察边界

用仓库验证与副作用测试证明报告关联需求、包和证据，不执行发布、部署、迁移或读取秘密值；
文档入口与相关测试通过，并真实运行 `pnpm check`。若全量仍有已独立复现的先存 setup/sanity
失败，必须保留完整输出、精确基线与差异分析交父会话决定门禁，不把先存失败称为全量通过，
不削弱测试或修理无关 setup 模块。此记录不自行豁免门禁。

本 Objective 以交付配置准备为范围，不自动扩展为 tarball 消费、CLI 命令发现、
第三方传递依赖执行证明或线上身份/资源验收。这些未执行事项保留在独立 `limitations`
与 `onlineVerified:false` 中，不阻断已满足的配置检查。
范围内不支持的服务/配置格式/能力、无法解析的实际导入或缺少必需产物仍为阻断性
`unverified`，不是成功形回退；`not-applicable` 只用于明确不适用的规则。
内部包、npm、CLI、browser、Worker 均须有真实 `pass` 正例，Pilot 对有效目标能到 terminal，
不通过导入任意自声明成功报告绕过规则。
