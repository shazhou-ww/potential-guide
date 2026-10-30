# Task 输入 Schema 与发现能力：讨论依据

本文支撑 [Idea.md](Idea.md)，不是第二份契约。来源是 [task-engine-web-ui](../../../../01M663BC641JV531CXWN5WD2AG/outer/inner/ideal/Idea.md) 的[源码调研](../../../../01M663BC641JV531CXWN5WD2AG/outer/inner/ideal/Research.md)。创建时仅授权独立准备；后续授权变化见下节，不能将此前讨论视为已经验收。

## 本 session 的后续授权

2026-10-31 00:23，用户明确授权本 session 再做调研并完善计划；没有 blocking issue 后，派一个 sub agent 实施，由本 session 负责所有 Silvermoon 门限审批，只有 blocking issue 才再请求用户决定。

该授权仅适用于本 idea；由主 Agent 对同步后的准确修订、测试及独立消费证据逐阶段审查，再记录对应 submit/accept，不等于预先通过尚未完成的工作。不改变 explicit 门限，不继承其他 session 授权，不授权 npm 发布或无关生产环境变更。子代理负责实现，不负责生命周期事件或向来源会话汇报。

## 已确认的用户方向

2026-10-30，用户回顾先前采用 validate、equals 行为判别的选择后明确提出：

> 我同意，我们还是把这两个函数替换为Schema，放在Task的定义层面上。

用户期望可自动生成 Validate、Equals，并支持类型发现、自动表单及后续消费者；同时询问采用 JSON Schema 还是必要子集，要求参考现有 Subject Schema。

2026-10-30，在本 idea 的独立 session 中，用户确认采用 JSON Schema Draft 2020-12 标准语义，另行明确运行限制；表单支持子集与任务契约分开。随后明确 Validate 与 Equals 的职责分离，见下文；具体运行限制与完整比较规则仍待收敛。这些讨论决定不构成实施授权、submit 或 accept。

本次替换指 Task 输入的 validate、equals，不自动扩展为删除 validatePrepared、validateResult、validateExecutionResult、validateProgress 或 prepare。

## 已核实的 Subject Schema 先例

基线：`1e9abaf4ac1fe1ef2eb5862823b697da75c7554b`。

- 当前 Checker/Objective 制品的 subjectSchema 要求根声明 `type: object`；不是手工维护的少数关键字白名单。见[制品契约](../../../../../../packages/check-artifacts/src/contracts.ts)，L59–63、L167–197。
- 使用 Ajv2020，`strict: true`、`allowUnionTypes: true`、`validateFormats: false`；采用同步 compile，没有配置远程 schema 加载器。见同文件 L232–233、L307–328。
- 已有[Draft 2020-12 元组测试](../../../../../../packages/check-artifacts/test/contracts.test.ts)，L56–76：`prefixItems`、`items: false`、`minItems` 确实约束数据，不是只验证普通对象字段。
- JSON 值另有有限数值、深度/体积和对象形状边界；这些资源约束不应因换 Schema 被移除。见[JSON 契约](../../../../../../packages/task-protocol/src/json.ts)，L19–64。

以上是当前制品 Subject Schema 的事实，不宣称仓库所有历史 schema 都使用完全相同的策略。

## 已确认的标准范围与待确认的运行约束

采用 **JSON Schema Draft 2020-12 的标准语义，加显式运行约束**，不为首版表单另造任务专用方言或任意裁剪验证关键字。标准范围及表单与任务契约的分离已确认，以下具体规则仍为待确认建议：

- 根输入为有限 JSON object，与当前通用请求剥离保留字段后的输入一致。
- 契约自包含；可复用本地 `$defs`/`$ref`，不允许验证期间自动联网取 schema 或执行自定义关键字代码。
- 校验不做类型强转、不自动补默认值、不移除额外属性；错误显式返回。Schema 的 default 可作为表单建议，但不能悄悄改变任务身份。
- format 是否仅注解需写入契约；若沿用 Subject Schema 当前设置，就不能承诺 format 会校验 URI 等业务规则。制品来源语法、摘要一致性、授权、运行时可用性仍由相应类型契约及准备/执行边界保证，不以换 Schema 为由删除。
- Schema 本身、引用和输入应有可验证的资源上限；复杂 schema 不因库支持就默认无成本。
- **表单渲染可先支持必要子集**，例如对象、数组、基本类型、枚举及必填/范围约束；高级组合或依赖结构必须有明确的不支持提示或经确认的编辑方式。不能把 renderer 不支持误报为服务不接受，更不能静默忽略约束。

这样既利用现有标准和 Ajv，也避免永久把引擎限制在首版表单能画出的字段集合。具体关键字、引用/递归限制与表单交互不在准备阶段预先穷举。

## 已确认：按 Schema 结构生成判等，与校验分离

用户明确要求由 Schema 定义的结构衍生 Equals 比较逻辑，作者不再提供任意 equals 函数。Equals 按既定逻辑判定两个对象是否相等，不判断对象是否符合 Schema，也不负责推导任意业务等价关系。

对于只定义一个 property 的结构比较示例，两个对象该字段相同，即使还包含值不同的额外字段，比较也忽略那些额外字段。Schema 若禁止额外字段，由 Validate 判定输入非法，而不是 Equals 的职责。Equals 不要求先通过 Validate，也不以校验结果替代比较结果；这不取消任务接收路径本身的校验。

此前 Agent 建议“两侧先满足同版本契约，再比较完整 canonical JSON”，现已撤回，不能作为已确认规则。Agent 提出的“只有承诺额外字段不影响任务行为才允许忽略”也不是用户确认的判等前提，不应并入 Equals 的职责。

用户进一步确认：Equals 可以通过判别字段或局部类型判断选择比较结构；识别比较结构与 Validate 的合法性校验是两回事。例如 Schema 以 kind 区分 file/path 和 url/url 两种结构时，可以按 kind 选择对应字段比较，但不执行完整校验，也不以字段满足长度等合法性约束作为比较前提。该决定仅允许结构选择，不代表复杂组合的完整算法已确认。

JSON Schema 标准本身没有定义 Equals；本项目需明确结构到比较逻辑的映射。缺失字段与显式值、类型不匹配输入、数组、数值以及组合/条件/引用和 additionalProperties、patternProperties 等结构的比较规则仍待收敛，尤其需要说明无法唯一选择结构时的确定行为。不能把简单 properties 示例直接当作所有 Schema 的完整算法，也不能偷偷用 Validate 决定对象是否有资格参与比较。

当前 Check/Probe 已采用 canonical 输入比较，见 [canonical](../../../../../../packages/task-protocol/src/json.ts) 及[契约文档](../../../../../../docs/artifact-contracts.md)。这只是迁移基线，不是本次生成式判等的目标规则；仍需核查全部类型和外部消费者，明确原自定义行为的迁移或拒绝策略。

输入相等也不等于必然共享执行：[Engine compatible](../../../../../../packages/task-engine/src/engine.ts)，L494–520，还要求类型/版本、环境、scope 和 Prepared 相等；时间匹配与执行所有权规则继续有效。幂等则保持同一 requestId 的完整原始请求比较，不能替换为忽略通用字段的输入比较。

## 已确认：无法由 Schema 表达的业务一致性检查进入 prepare

2026-10-31，用户确认允许将 Schema 无法表达的业务一致性检查移到 prepare，并接受从提交拒绝变为准备失败的明确行为变化。具体例子是 Probe 的 objective.digest 与 bindings[objective.url] 一致性；检查不能删除，也不能把冲突默默解释为某一字段优先。

这不改变 Equals 的职责，也不授权实现。它不涵盖把提交前防止敏感数据持久化的边界一并延后。现有调用点、比较反例和剩余风险见[生成能力与迁移调研](Research.md)；其中建议与未决项不代表用户已经同意。

## 类型发现与动态 subject 的分工

通用发现面向服务实际注册且可提交的类型、对应契约版本和输入 Schema；契约与注册版本的绑定、鉴权范围、旧版查询和兼容策略由本 idea 收敛，路由名称尚未决定。

2026-10-31，用户通知新增的消费者边界：首版通用 Web UI 撤出资产管理；不是所有 Task 都有资产，Probe/Regulator 也可能共享资产，通用 TaskType 资产管理不应成为 Engine 或通用 UI 的职责。未来至多按具体类型考虑独立工具 UX，尚未选择架构。本 idea 独立继续，不依赖资产管理 idea 的推进，也不把资产管理或制品 subjectSchema 查询接口作为类型发现或通用 UI 的前置条件。

通用 UI 只消费 Task 公开输入 Schema，不从业务 URL 自动解析或下载制品。若某类型只把 subject 声明为普通 object，消费者可提供对象输入，不臆造具体字段，也无需先查找制品 subjectSchema。URL、digest 等仍可作为普通任务参数填写和原样复用，不意味着消费者管理它们指向的资产。

Task 类型 Schema 描述输入外形；具体制品 subject 校验、业务检查及运行时约束仍由原所属边界负责。此消费者范围更新不改变已确认的 Equals/Validate 职责，不决定自由 JSON 节点等 Schema 未决项，不构成生命周期决定或实施授权。

与 [schema-contracts](../../../../01M5CR0X2B4R2C6K3183Y1T3SQ/outer/inner/ideal/Idea.md) 保持公共契约归属一致；本 idea 不替该总讨论决定其他格式。它是现有通用任务契约的后续演进，不撤销或伪造既有 idea 的生命周期事实。
