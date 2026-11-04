# Implementation

## Steps

### I-S01: 确认预编译边界

梳理 compileTaskBundle、buildTaskBundle 及 author check/build 到 Worker 的完整路径，确认 input、result、message 契约的生成位置，以及协议模块初始化带来的间接依赖。评估 Ajv standalone 或等价方案，不在本契约中预先绑定具体实现。

本次边界是 Task Bundle 构建链及其注入的 Worker 运行时，不要求从构建工具、Task Engine 或其他独立 Schema 消费者中移除 Ajv。作者主动引入的业务依赖不属于 SDK 固定开销；不得用默认模板未引入这些依赖来掩盖 SDK 的间接引入。

### I-S02: 接入构建期校验器生成

在构建时完成契约解析、引用闭包检查及校验器生成；Worker 只执行已生成的校验函数及必要辅助代码，不再根据 Schema 创建编译器或动态生成校验代码。覆盖所有现有构建入口，避免只优化 CLI 默认模板。

运行时仍保留不可信数据的检查、输入大小及资源预算、错误报告、声明一致性和现有 Worker 协议。若生成产物改变 Bundle 字节或 CID，应明确记录；不要求新旧 CID 相同，也不得静默接纳已经不受支持的旧产物。

### I-S03: 补齐回归和体积证据

围绕以下验收标准补充自动化测试和可复现证据，更新直接相关文档。实施证据只证明仓库内实现；真实包消费和隔离执行环境的验收由 [Deployment.md](../Deployment.md) 单独定义。

## Acceptance criteria

### I-AC01: 构建期生成与运行期依赖隔离

- input、result、message 的非法契约、未解析引用及不受支持的 Schema 在 author check/build 中明确失败；author check 保持无产物写入。构建失败不得破坏已有受管理输出。
- 对真实默认 init 模板和包含共享引用、组合约束的代表性任务检查 esbuild metafile。SDK 引入的代码不得包含 Ajv 通用入口、core、compile/codegen、vocabularies、元 Schema 或 fast-uri；不得以 external、动态加载、旁路下载或共享全局依赖绕开检查。允许按需打入的 ajv/runtime 小型辅助函数，并逐项记录来源和字节贡献。
- 通过真实 Worker 启动及多次数据处理测试证明执行的是预生成函数，不在启动或请求处理中重新编译 Schema；静态依赖图与执行证据共同验收，不能仅搜索产物中的字符串或只验证一次成功返回。

### I-AC02: 数据校验与协议语义保持一致

以现有协议 Schema 校验为对照，同一组有效和无效数据分别经过原校验路径、预生成路径及真实 Worker；记录预期结果，不能只比较两者是否都没有抛错。

- 数据边界：输入在业务回调执行前校验；非法输入不得调用回调。回调结果及业务消息仍按各自契约校验，Never 消息不得因预编译而被放行。保留对外错误代码、错误结构及已有稳定错误文本，不要求内部生成函数名或栈位置一致。
- Schema 边界：覆盖现有支持的 required/optional、类型和数值/字符串约束、数组与 tuple、record/patternProperties、additional/unevaluated 属性或元素、组合约束、布尔 Schema、共享和局部引用及引用的同级约束、原型名称字段。以 [schema.test.ts](../../../../../packages/task-protocol/test/schema.test.ts)、[bundle.test.ts](../../../../../packages/task-sdk/test/bundle.test.ts) 和 [authoring.test.ts](../../../../../packages/pguide-task-bundle/test/authoring.test.ts) 的既有行为为下限；不新增 Schema 方言、远程引用、格式语义或静默降级。
- 行为边界：不得新增类型强制转换、默认值填充、字段删除或输入变异；输入投影、等价关系及 revision 语义保持一致。现有载荷和 Schema 预算、声明绑定、消息、日志、进度、取消和资源流回归继续通过。定向测试及 pnpm check 通过。

### I-AC03: 体积改善与可复现交付

- 使用真实 init 默认 Echo 模板，不手写更小的替代任务。改动前后固定依赖锁定版本、Node/esbuild 版本和构建参数，记录基线提交、测量命令、Worker 原始字节数、Bundle 文件总字节数及逐依赖贡献。gzip 大小只能作为补充，不能替代实际交付体积。
- 当前观察基线是 Worker 167,151 字节、Bundle 文件合计 167,914 字节；实施时从记录的基线提交复测并解释环境差异。相同环境下新 Worker 和 Bundle 文件总量都必须小于基线，同时满足 I-AC01 的编译器移除标准；不能只把代码搬到另一个随包文件。此阶段不承诺未经验证的固定 KiB 或降幅百分比。
- 分析用构建与正式构建的 Worker 字节一致；相同作者输入在独立目录构建得到相同 Worker 字节和 CID。生成校验代码不得引入绝对路径、时间戳或构建机器状态，所有非内置运行依赖仍随 Bundle 完整交付。
