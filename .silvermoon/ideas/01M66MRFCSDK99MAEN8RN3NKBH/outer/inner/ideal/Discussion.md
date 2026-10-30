# Task 输入 Schema 与发现能力：讨论依据

本文支撑 [Idea.md](Idea.md)，不是第二份契约。来源是 [task-engine-web-ui](../../../../01M663BC641JV531CXWN5WD2AG/outer/inner/ideal/Idea.md) 的[源码调研](../../../../01M663BC641JV531CXWN5WD2AG/outer/inner/ideal/Research.md)。创建本 idea 是为了交给后续独立 session 继续讨论，不代表开工、验收或发布。

## 已确认的用户方向

2026-10-30，用户回顾先前采用 validate、equals 行为判别的选择后明确提出：

> 我同意，我们还是把这两个函数替换为Schema，放在Task的定义层面上。

用户期望可自动生成 Validate、Equals，并支持类型发现、自动表单及后续消费者；同时询问采用 JSON Schema 还是必要子集，要求参考现有 Subject Schema。语言标准、约束细目与判等语义尚未最终选择。

本次替换指 Task 输入的 validate、equals，不自动扩展为删除 validatePrepared、validateResult、validateExecutionResult、validateProgress 或 prepare。

## 已核实的 Subject Schema 先例

基线：`1e9abaf4ac1fe1ef2eb5862823b697da75c7554b`。

- 当前 Checker/Objective 制品的 subjectSchema 要求根声明 `type: object`；不是手工维护的少数关键字白名单。见[制品契约](../../../../../../packages/check-artifacts/src/contracts.ts)，L59–63、L167–197。
- 使用 Ajv2020，`strict: true`、`allowUnionTypes: true`、`validateFormats: false`；采用同步 compile，没有配置远程 schema 加载器。见同文件 L232–233、L307–328。
- 已有[Draft 2020-12 元组测试](../../../../../../packages/check-artifacts/test/contracts.test.ts)，L56–76：`prefixItems`、`items: false`、`minItems` 确实约束数据，不是只验证普通对象字段。
- JSON 值另有有限数值、深度/体积和对象形状边界；这些资源约束不应因换 Schema 被移除。见[JSON 契约](../../../../../../packages/task-protocol/src/json.ts)，L19–64。

以上是当前制品 Subject Schema 的事实，不宣称仓库所有历史 schema 都使用完全相同的策略。

## 建议：标准 Schema 与表单支持范围分开

建议使用 **JSON Schema Draft 2020-12 的标准语义，加显式运行约束**，而不是为首版表单另造任务专用方言或任意裁剪验证关键字。以下均为待确认建议：

- 根输入为有限 JSON object，与当前通用请求剥离保留字段后的输入一致。
- 契约自包含；可复用本地 `$defs`/`$ref`，不允许验证期间自动联网取 schema 或执行自定义关键字代码。
- 校验不做类型强转、不自动补默认值、不移除额外属性；错误显式返回。Schema 的 default 可作为表单建议，但不能悄悄改变任务身份。
- format 是否仅注解需写入契约；若沿用 Subject Schema 当前设置，就不能承诺 format 会校验 URI 等业务规则。制品来源语法、摘要一致性、授权、运行时可用性仍由相应类型契约及准备/执行边界保证，不以换 Schema 为由删除。
- Schema 本身、引用和输入应有可验证的资源上限；复杂 schema 不因库支持就默认无成本。
- **表单渲染可先支持必要子集**，例如对象、数组、基本类型、枚举及必填/范围约束；高级组合或依赖结构必须有明确的不支持提示或经确认的编辑方式。不能把 renderer 不支持误报为服务不接受，更不能静默忽略约束。

这样既利用现有标准和 Ajv，也避免永久把引擎限制在首版表单能画出的字段集合。具体关键字、引用/递归限制与表单交互不在准备阶段预先穷举。

## 判等不能单靠 Schema 推导

Schema 回答“数据是否合法”，不回答“这两个合法输入在业务上是否等价”。例如大小写不同的路径、顺序不同的数组或省略字段与显式默认值，不会因为通过同一 Schema 就相等。

建议生成的 Equals 采用：**两侧都满足同版本输入契约后，按已有 canonical JSON 结构判等**。对象键顺序无关、数组顺序有关；缺省字段与显式值不同，不自动忽略字段、补默认值或做路径/大小写归一化。有限 JSON 数字与 `-0` 等细节沿用现有 canonical 契约。证据见 [canonical](../../../../../../packages/task-protocol/src/json.ts)，L74–82，及[契约文档](../../../../../../docs/artifact-contracts.md)的 canonical request JSON 说明。

这是提议的统一规则，不是假称 Schema 能生成原来任意 equals 函数的全部语义。当前 Check/Probe 已采用 canonical 输入比较；仍需核查全部类型和外部消费者，明确原自定义行为的迁移或拒绝策略。

输入相等也不等于必然共享执行：[Engine compatible](../../../../../../packages/task-engine/src/engine.ts)，L494–520，还要求类型/版本、环境、scope 和 Prepared 相等；时间匹配与执行所有权规则继续有效。幂等则保持同一 requestId 的完整原始请求比较，不能替换为忽略通用字段的输入比较。

## 类型发现与动态 subject 的分工

通用发现面向服务实际注册且可提交的类型、对应契约版本和输入 Schema；契约与注册版本的绑定、鉴权范围、旧版查询和兼容策略由本 idea 收敛，路由名称尚未决定。

Task 类型 Schema 描述输入外形；Check/Probe 中具体 subject 的字段仍取决于所选制品的 subjectSchema。类型资产元数据由独立 [task-type-artifact-management](../../../../01M66N2BDVY4B6VAHVEEVB94EW/outer/inner/ideal/Idea.md) 收敛，不在通用发现中下载或执行任意制品，也不将所有业务字段硬编码到 UI。

与 [schema-contracts](../../../../01M5CR0X2B4R2C6K3183Y1T3SQ/outer/inner/ideal/Idea.md) 保持公共契约归属一致；本 idea 不替该总讨论决定其他格式。它是现有通用任务契约的后续演进，不撤销或伪造既有 idea 的生命周期事实。
