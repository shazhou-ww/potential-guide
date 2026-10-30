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

## 当前准备结论

方向可行，但尚不能声称候选已就绪。优先形成自由 JSON 节点与重叠分支的有限反例集；并核对提交前敏感数据边界、发现后契约漂移及历史绑定策略。这些是准备阶段的语义或兼容问题，不是启动实现的理由。资源阈值、路由名称和内部代码组织可以后续提出具体建议，不先向用户逐项索取偏好。
