# Schema 生成能力与迁移边界调研

本文支撑 [Idea.md](Idea.md) 和[讨论依据](Discussion.md)，不是第二份契约或实现设计。源码基线为 `6ffc3cb959ac58d355856fbbc210bf50758b3150`；本次仅做源码核对和反例推演，没有实现新 Schema 或 Equals。

## 已核实的接入点

| 证据 | 当前事实 | 准备结论 |
| --- | --- | --- |
| [TaskType / RegisteredType](../../../../../../packages/task-protocol/src/types.ts)，L163–197 | 作者提供 validate、equals，且其他阶段校验独立存在 | 替换输入定义不能顺带删除 Prepared、结果和进度校验 |
| [Engine validated](../../../../../../packages/task-engine/src/engine.ts)，L168–194 | 输入经过有限 JSON 检查、冻结，validator 输出不得改变 canonical 内容；历史读取也使用原类型校验 | 不强转、不补默认、不删字段与现有引擎方向一致；历史恢复不能只改新提交路径 |
| [Engine parse / submit](../../../../../../packages/task-engine/src/engine.ts)，L258–340 | currentVersions 选择新任务版本，剥离通用请求字段后校验；幂等比较完整原请求 | 输入 Schema 不是完整 HTTP 请求 Schema；输入 Equals 不替换 requestId 幂等 |
| [Engine compatible](../../../../../../packages/task-engine/src/engine.ts)，L494–520 | 输入 equals 之前还比较类型、版本、环境、scope 和 Prepared；随后检查时间 | 结构判等改变不自动取消其他共享条件 |
| [Check 输入及判等](../../../../../../packages/check-task/src/index.ts)，L77–94、L217–232；[Probe 判等](../../../../../../packages/probe-task/src/index.ts)，L352–367 | 当前 equals 校验另一侧，再比较完整 canonical JSON | 新职责分离是实质行为变化，不是机械重命名 |
| [Server](../../../../../../packages/task-engine-server/src/index.ts)，L107–133；[HTTP handler](../../../../../../packages/task-engine-http/src/index.ts)，L160–219 | 启动配置要求 validate/equals 函数；当前 HTTP 没有类型发现路由 | 后续需同时覆盖协议、引擎、启动校验和 HTTP，不能只修改 TaskType |

这不是所有外部消费者的穷尽清单。仓库测试夹具也构造 TaskType，例如 [echoEquals](../../../../../../packages/task-engine/test/fixtures.ts)，L28–43；公共接口变更后需核对打包消费者，而不是只让两个内置类型通过编译。

## Equals：建议、反例与未决项

已确认：按 Schema 结构生成比较、忽略简单 properties 示例中的额外字段、与 Validate 分离，并允许按判别字段或局部类型选择结构。以下是准备候选，不是新增用户决定。

| 情形 | 建议或待明确规则 | 验证重点 |
| --- | --- | --- |
| 命名属性 | 比较声明字段及其存在性，忽略未被比较结构覆盖的属性 | 键顺序不影响结果；额外字段不同仍可相等 |
| 缺省与显式值 | 建议缺失不同于 null 或显式默认值，不补 default | 两侧都缺失可相等，即使 required 会使 Validate 失败 |
| 原始值 | 建议严格区分 JSON 类型，不做字符串/数字强转或大小写归一化 | `1` 与 `"1"` 不同；`-0` 与 `0` 的数值处理需与已有 JSON 边界协调 |
| 数组与元组 | 建议保留顺序和长度，按 items / prefixItems 对应结构递归比较 | items:false 的合法性限制不自动给非法数组定义比较结果；额外位置规则仍需明确 |
| 明确判别的联合结构 | 每侧独立选择结构，再比较结构标识和对应字段 | 分支选择不依赖比较的另一侧；标签缺失或未知时不能隐式调用完整 Validate |
| 无约束子节点、字典 | 建议显式声明的自由 JSON 节点比较其完整 JSON 内容；schema-valued additionalProperties 描述动态键和值 | subject、context、bindings 需要表达自由对象或映射；不能因没有 properties 就一律比较为空 |
| 组合与条件 | 需要确定的结构组合规则，不能直接把验证关键字翻译为布尔比较运算 | anyOf、oneOf、allOf、if/then/else 的校验语义不是现成的 Equals 语义 |
| 非法形状的输入 | 需要确定且不执行 Validate 的处理规则 | 同时缺字段、错误类型、无法选择分支不能成为未定义行为；不要求把任意非 JSON JavaScript 对象都纳入输入域 |

自由节点的规则仍有实质歧义：`additionalProperties` 省略与显式 `true` 在 JSON Schema 校验上等价，但不能擅自令前者忽略额外字段、后者比较额外字段。Schema 的验证等价不必自动意味着结构判等等价，不过这种区别若被采用必须明确公开。当前尚未采纳该区别，也未给 Schema 增加私有关键字。

### 联合分支的非传递反例

若把两个属性分支的比较直接定义为 `x 相等 OR y 相等`：

- A = `{x: 1, y: 0}`
- B = `{x: 1, y: 1}`
- C = `{x: 2, y: 1}`

则 A 与 B 相等、B 与 C 相等，但 A 与 C 不等。已用独立 Node 断言核对这个推演，不是新比较器测试。简单按 anyOf 做比较结果 OR 会破坏传递性，执行候选选择可能受顺序影响。

建议将自反、对称、传递作为比较规则的验证要求；使用每个输入自身确定的结构投影是候选方向，不在准备阶段预先决定代码生成方式。重叠分支、无分支可选和自由节点仍需给出完整实例后收敛，不能把“标准 Schema 校验受支持”冒充“所有结构的 Equals 映射已解决”。

## 已确认的业务检查迁移与不能放宽的边界

[validateProbeInput](../../../../../../packages/probe-task/src/contracts.ts)，L76–107，会读取 `bindings[objective.url]` 并与 `objective.digest` 比较；这是动态跨字段一致性，不是标准 Draft 2020-12 可以通用表达的静态校验规则。

2026-10-31，用户确认：Schema 无法表达的业务一致性检查允许移到 prepare，保留检查，并明确接受失败时机从提交直接拒绝改为接受任务后准备失败。该决定不授权实现，不涉及 Equals，也不要求给 Schema 加私有扩展。

后续实现需证明这个已确认变化：

- 结构合法但摘要冲突的请求可创建任务，随后出现 preparation_failed；不是静默选择其中一个摘要。
- 在制品下载或执行等不必要外部动作之前做可本地完成的冲突检查。
- [Probe prepare](../../../../../../packages/probe-task/src/index.ts)，L368–389，目前会优先选 bindings 中的摘要；删除旧 validate 中的检查而不显式迁移，会丢失冲突拒绝。
- [decodePrepared](../../../../../../packages/probe-task/src/contracts.ts)，L168–191，也调用 validateProbeInput；新提交、Prepared 检查与历史恢复须分别核对，不能靠间接调用偶然保住行为。

这不是把所有既有拒绝统一延后。特别是 [validateArtifactReference](../../../../../../packages/check-artifacts/src/contracts.ts)，L347–389，拒绝来源 URL 中的用户名、密码和疑似凭据查询参数；[Engine submit](../../../../../../packages/task-engine/src/engine.ts)，L336–340，会持久化任务及原始请求。若把此类检查简单移到 prepare，拒绝前凭据已可能被写入存储。提交前的敏感数据边界必须保留；能否由标准 Schema 完整表达现有 URL 规则，或需要独立的公共输入边界机制，仍须调研，不包含在本次业务检查迁移批准中。

## 类型发现、版本与历史：建议边界

- 当前 [TaskRequest](../../../../../../packages/task-protocol/src/types.ts)，L16–25，没有独立类型版本选择字段；引擎根据 currentVersions 绑定版本。建议默认发现集来自当前可提交映射与实际注册定义的交集，而不是把仅为恢复加载的旧版本都当作可提交类型。
- “刚发现旧 Schema，提交时服务已切到新版”是实际竞态。建议公开类型版本和契约修订，并明确客户端如何阻止契约漂移；具体请求前置条件或版本选择方式尚未确定。仅在发现响应展示版本不足以解决竞态。
- [Authorize / Operation](../../../../../../packages/task-protocol/src/types.ts)，L132–138，目前按操作和 scope 授权，没有类型参数。不能声称现有授权已能逐类型筛选；发现操作、类型可见性与提交权限如何对应需明确，未确认扩大到新的权限管理系统。
- 建议历史绑定继续使用原版本及原语义；变更比较规则不能只覆盖同一版本实现后重解释旧记录。缺少原契约须明确失败，是否保留适配器及其生命周期仍待迁移方案验证。
- 类型发现只暴露声明式契约和必要身份，不暴露执行函数、环境配置或凭据。Task 输入 Schema 与通用请求字段要明确区分。按用户新增消费者边界，资产管理与制品 subjectSchema 查询均不是通用类型发现或 UI 的必需前置；只声明为普通 object 的 subject 可以作为对象输入，不能推断未声明的业务字段。
- URL、digest 是可填写、原样复用的普通任务参数，不触发通用 UI 自动解析或下载制品；具体业务和运行时校验保留在原所属边界。未来是否存在具体类型的独立工具 UX 尚未选定，不在本 idea 中预设资产架构。该范围更新不解决自由节点的 Equals 规则。

## 授权后的方案收敛

以下是主 Agent 在用户授权下选择的实施约束，不伪称为用户逐条选定的算法。若实现证据不能满足这些约束，必须报告阻塞，不能静默降低标准。

1. **Validate 与结构投影分离。** 使用 Ajv2020 的 Draft 2020-12 校验；strict、allowUnionTypes 开启，format 仅注解，不强转、不填默认、不移除字段。Equals 比较每侧独立生成的确定性结构投影，不调用 Validate。验证约束如 required、长度、数值范围、additionalProperties:false 不成为比较准入门槛。
2. **自由 JSON 与有形状对象分开。** 存在命名属性或 patternProperties 等结构时，只比较结构覆盖字段及存在性；没有任何字段结构的自由 JSON 节点保留完整内容。布尔 additionalProperties 的省略、true 和 false 不独自扩大比较字段；schema-valued additionalProperties 明确声明字典值结构并覆盖动态键。这样普通 subject object 可保留完整对象比较，只有 foo 的对象结构则忽略其他字段，不需要加载制品。
3. **组合不使用比较结果 OR。** 多个结构贡献合成为有序、确定的投影；可用 type、const/enum 判别字段独立选择分支，但不能执行完整 Schema 验证来选择。不能由这些局部信息区分的分支，保留其全部结构贡献，不任意挑第一个。条件的业务断言仅用于 Validate；比较器可合并 then/else 的结构而不执行断言。数组保留长度和顺序；缺失与显式 null/default 区分；类型不匹配的有限 JSON 使用带类型的原值表示，确保非法输入也具有确定行为。用自反、对称、传递与重叠分支反例测试证明。
4. **显式运行边界。** Schema 由可信服务注册而非请求上传；仅接受自包含同步契约，不联网、不执行自定义关键字。先支持本地 JSON Pointer 引用及有限无环引用图，拒绝远程引用、动态引用、循环 Schema 和异步 Schema；引用/深度/节点/字节预算在编译时检查，输入沿用有限 JSON 与引擎预算。不声称这等于支持无限资源的所有合法标准文档；也不因表单能力裁剪验证关键字。
5. **敏感数据拒绝不后移。** 内置制品 URL 的提交前安全形状用可公开的标准 Schema 限制：禁止 userinfo、片段、可疑凭据查询键及可绕过这些限制的编码形式；必要时采用保守的查询键语法，并在新版迁移文档列明比旧规则更严格的输入。URL 规范化及业务引用解析留在 prepare，先做本地检查再访问来源。禁止为迁移重新引入作者 validate/equals 或私有校验关键字；标准 Schema 无法可靠保护该边界时为阻塞。
6. **公开发现与契约漂移。** 发现仅暴露当前可提交的类型、版本、输入 Schema 及稳定契约修订，不包含执行环境/函数/凭据，不加载资产。复用 caller/scope 和现有 submit 授权判断，明确没有新增逐类型 ACL。客户端可携带公开的契约修订前置条件；服务端在持久化前拒绝陈旧修订，不默默按另一版解释。前置条件是传输/提交元数据，不落入业务输入 Equals，也不得污染既有 requestId 幂等语义。
7. **不静默迁移历史。** 内置 Check/Probe 新语义使用新类型版本；恢复依赖原绑定，不自动升级历史记录。对已存记录缺失契约身份或缺少原类型时明确报告不支持，不能把同名版本换成新 Schema 后继续共享。外部消费者要迁移声明；不添加永久双轨作者 validate/equals 兼容接口。Prepared、结果和运行时校验保留，Probe 摘要冲突按已批准方向在 prepare 检查。

## 当前准备结论

上述选择为自由节点、联合结构、敏感输入、契约漂移和历史绑定提供了可测试路径，目前没有需要用户先做产品取舍的已知阻塞。实现尚未完成，正确性须由测试及主 Agent 审查证明；若具体标准 Schema 无法可靠保护敏感数据、投影无法满足等价关系或历史会被重解释，则停止相关推进并报告。门限依据本 session 新授权逐阶段执行，不因为调研结论直接记录实施或部署通过。
