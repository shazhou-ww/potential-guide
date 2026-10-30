# 实施审查矩阵

本文支撑 [Implementation.md](Implementation.md)，记录主 Agent 的验证要求及下方执行结果。实现由一个子代理完成，主 Agent 负责验证、同步和准确修订审批；未执行项不得计为通过。

## I-AC01: 声明与生成行为一致

| 场景 | 必须观察到的行为 |
| --- | --- |
| 仅声明 foo | 两侧 foo 相同、额外字段不同仍相等；禁止额外字段时 Validate 拒绝，但 Equals 不因此失败 |
| 校验非法但结构相同 | 缺少 required、违反 minimum/minLength 的相同有限 JSON 输入可以相等；没有隐式 Validate 调用 |
| 缺省与默认值 | 缺失与 null/显式 default 不同，不强转、不填值、不删除属性 |
| 自由对象及字典 | subject 普通 object 的内容变化可区分；schema-valued additionalProperties 的动态键和值被比较 |
| 数组与元组 | 长度、位置和 prefixItems 结构生效；输入验证继续遵守 items:false 等标准规则 |
| 组合和分支 | 重叠 anyOf/oneOf 的比较不使用 OR；自反、对称、传递；不同属性顺序和分支候选不造成非确定结果 |
| 引用 | 本地引用的兄弟关键字不被忽略；不误将 const/default 对象当作 Schema 扫描 |
| 运行约束 | 远程/动态/异步/循环 Schema 及超预算契约显式失败；输入超深度/体积继续拒绝；不执行 getter 或 toJSON |
| 契约不可变 | 注册后修改作者原 Schema 不改变服务校验、比较或公开修订；发现响应不能反向修改注册定义 |

## I-AC02: 发现结果可信且受控

| 场景 | 必须观察到的行为 |
| --- | --- |
| 实际可提交集 | 仅列出 currentVersions 指向的已注册类型，不把仅为恢复加载的旧版本当作可提交类型 |
| 身份和权限 | 未认证/未授权明确失败，合法 caller/scope 可发现；不伪称已有逐类型 ACL |
| 内容边界 | 只有声明式契约及必要身份，不包含环境、函数、凭据；发现不解析业务 URL 或查询制品 |
| 修订前置条件 | 新提交携带旧修订时在写入前拒绝；使用新修订可以提交；省略时保持文档说明的默认行为 |
| 幂等 | 同 requestId 相同原始请求不受传输前置条件误污染；不同原始请求仍冲突，不改用输入 Equals |
| 消费路径 | 协议、引擎、HTTP、服务启动、例子和打包消费者均使用新定义，不留作者 validate/equals 双轨入口 |

## I-AC03: 执行语义与迁移可复核

| 场景 | 必须观察到的行为 |
| --- | --- |
| 共享边界 | 输入相等不越过版本、环境、scope、同步授权和事件时点边界；不恢复 Prepared 匹配前提，Prepared 执行/结果校验及取消/执行所有权回归仍成立 |
| 摘要冲突 | 结构合法且同步授权通过的新 Probe 请求可接收，但在下载前准备失败；不能默默选择一个摘要继续执行 |
| 敏感输入 | known artifact URL 中 userinfo、片段、大小写/编码绕过的凭据查询键在持久化前拒绝 |
| 历史 | 正确契约身份可恢复；缺失/不同契约身份或原版本明确失败，不重写既有输入事实 |
| 直接调用 | 内置公开校验辅助函数由唯一 Schema 生成；prepare、Prepared 与结果校验仍保留业务边界 |
| 完整验证 | pnpm check 通过；若出现环境瞬态失败，记录失败和重试，不将重试掩饰为首次通过 |

## 独立消费验证衔接

实施审查通过后，由主 Agent 按 [Deployment.md](../Deployment.md) 在本 session 拥有的独立安装目录验证打包产物及真实 HTTP。端口由系统分配，使用自有数据库和进程，验证后确认关闭。不得使用开发源码路径替代已安装包，不将测试套件通过冒充独立消费通过。

## 执行结果

2026-10-31，子代理完成初版及一次修正，主 Agent 完成源码审查和独立复测（以下为整合并发 primary 之前的证据）：

- `pnpm check` 通过，包含构建、格式、lint、类型检查、测试和独立打包消费者。准备阶段首次基线运行曾有无代码变更的 objective-monorepo-standard 子进程测试失败；该包单独复测及完整基线重试均通过。实现修正后的全量检查通过。
- 主 Agent 执行 `pnpm --filter @potential-guide/task-protocol --filter @potential-guide/task-engine --filter @potential-guide/task-engine-http --filter @potential-guide/probe-task test`：11 + 61 + 5 + 16 = 93 项通过，0 失败。
- 主 Agent 直接从构建产物运行断言，复核 required 的 `toString`、`constructor`、`__proto__` 必须为自有 JSON 字段，且存在时仍检查字段值类型；schema-valued unevaluatedItems 的额外字段忽略也通过。
- 首次审查发现 Ajv 默认把原型链字段算入 required，以及比较器遗漏 schema-valued unevaluatedItems；已由同一子代理修复。编译开启 ownProperties，并以等价标准 pattern 补足 Ajv 对 properties.__proto__ 的跳过；比较器按本地 prefixItems、显式 items、schema-valued unevaluatedItems 顺序选择结构，不声称重演验证器的 evaluated 注解。契约算法身份更新为 projection-v2，避免复用旧候选身份。
- [Schema 测试](../../../../../packages/task-protocol/test/schema.test.ts)覆盖独立判等、自由对象/字典/模式、等价关系、引用兄弟关键字、元组、非法输入、预算和注册不可变性；[发现测试](../../../../../packages/task-engine/test/discovery.test.ts)覆盖权限、版本前置条件、原请求幂等、历史和执行契约身份；[Probe 测试](../../../../../packages/probe-task/test/input-schema.test.ts)覆盖敏感 URL 提交前拒绝及摘要冲突在零来源调用下准备失败。
- 既有引擎、HTTP、存储、真实 worker 取消/回收和重启测试均由完整检查执行；旧 validator/equals 夹具迁移到 Schema，未保留作者双轨入口。注册对象现在被隔离冻结，原先通过运行中修改作者对象模拟环境变化的测试改为验证隔离，不取消恢复时的环境绑定检查。

随后刷新发现 primary 已加入事件时点绑定、同步授权及存储格式 2。当前正在保留两侧历史的普通 merge 中整合这些变化；前述 93 项结果不能替代整合后的复测，I-S02/I-S03/I-AC02/I-AC03 重新置为未完成。旧 Ideal 对 Prepared 匹配的描述同步修正后将重新提交/审批，不能使用过期批准。独立真实 HTTP 的新功能部署验证尚未执行，不以本节替代 Outer World 验收。

### 并发整合复测

已解决四处源码/README 冲突，保留两侧实现：输入仍由 Schema 生成，原作者 validate/equals 不恢复；保留同步 authorize、started/terminated 事件绑定、存储/投影版本 2，以及 Prepared 不作为匹配前提。

- 子代理：162 项定向测试、`pnpm check`、42 项脚本测试及全部独立打包消费者通过。
- 主 Agent：`pnpm --filter @potential-guide/task-protocol --filter @potential-guide/task-engine --filter @potential-guide/task-engine-http --filter @potential-guide/probe-task --filter @potential-guide/task-engine-storage test`，11 + 75 + 5 + 17 + 24 = 132 项通过，0 失败。
- 新回归证明生成式输入相等不能绕过事件时点同步授权；无对应 Task 的执行事实仍检查契约身份。Probe 摘要冲突允许同步授权，但 prepare 在任何 resolve/download 前失败。
- Silvermoon 候选检查曾因共享 origin/main 跟踪引用已包含其他 idea 的更新事件而拒绝旧候选前缀；未删除或重写事件，已将确认没有本地修改的其他 idea 原样整合到最新 primary 文档/事件后，完整 worktree 检查通过。后续所有检查均等进程结束后读取日志和真实退出码，不截断命令输出。

整合后的代码与文档已同步至 primary `27301106f068ecf1742c4ffc2d5e00c76134490c`。准确 Ideal 修订 `b76dc3d309967f902efb833489372e9ce2b02cb7` 已重新 submit/accept，并同步至 `7df1e21058beec180584cd89f9d9cbd00104fead`；未复用旧批准。主 Agent 根据上述审查及整合复测确认 I-S01–I-S03、I-AC01–I-AC03 完成，没有已知阻塞，允许提交当前准确实施修订。独立消费验证仍由下一阶段负责。
