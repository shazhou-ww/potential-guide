# 实施契约与兼容边界

## 制品与作者工具

`check-artifacts` 新增独立 Checker/Objective YAML v1 解析、目录页组合、统一结果、
带类型来源、Git SHA-256 树计算及作者 build/write/pack API。旧 manifest、归档、
缓存及摘要函数保留。历史证据不修改，也不把旧内容摘要换前缀。

新逻辑摘要与 transportDigest 分开；执行胶囊由准确入口字节构造，其既有 worker
revision 仍按原算法独立验证。Node 实际版本、平台、架构和 adapter 进入共享键及叶子证据，
manifest.minVersion 仅为准入下界。没有 Python adapter 或 Objective 同 runtime 约束。

JSONata 实施为可移植、有界的 selection profile：`$`、必须存在的对象路径、JSON
字面量、对象/数组构造。无函数、隐式数组路径遍历、扩展、IO 或无限计算。
限制为 4096 字符、256 token、16 层表达式和 1 MiB UTF-8 JSON 对象结果
（含 JSON 结构字节）；缺失路径明确失败。数组只接受普通原型、连续索引且无命名属性，
不因校验后序列化而执行继承的 toJSON 或把稀疏项静默变为 null。
详细作者契约与入口调用/Task payload 映射在 `docs/artifact-contracts.md`。

目录页完整替换，base 页面保留原始 owning digest/path；frontmatter 与 wiki
链接统一校验。新缺页明确 404，不恢复 system/404。Objective 可由覆盖补齐语言；
此时子 Checker 在其声明的支持语言中明确选择执行语言，根/子快照分别记录选择，
不假装 Checker 原制品已新增该语言。新格式不暴露资源地址。

## 服务与时序

现有 Check Host kernel、worker 清理与 v2 调度不重做。新增 `CheckerService`
通过新公共准入及共享 Task 仲裁调用同一 kernel。`ObjectiveService` 复用该仲裁，
通过 Check Service port 直接创建子 Task，服务核心不创建 listener。

每个 Task 的受理序号、期限、幂等键独立；整个 Execution 的 started/completed
使用服务内单调序号，不跨服务比较客户端时间。准备结束后原子匹配保留完成结果、
运行执行或预约执行，允许晚解析请求使用仍满足 freshness 的结果。
取消/到期仅撤销自身需求；最后 owner 封口并取消自身子 Task。迟到结果不复活终态。

Probe 默认 60 秒、最大 600 秒；执行墙钟固定 600 秒，不被后来 Task 延长。
Check 默认 30 秒、最大 120 秒；Objective 子 Task 使用剩余执行预算并受 Check 上限约束。
依赖深度 8、观察数 64、调用数 128；Task/Execution 保留各 256，
监听者 64、单流最多 64 Task。进展 1 MiB、最终结果及证据合计 4 MiB，
均按序列化 UTF-8 JSON 字节计量；进展与结果在序列化前校验有限 JSON。
快照保留 60 秒，不承诺中间状态回放或跨重启透明执行恢复。

新 Observation Execution 的 start 先于任何业务观察，之后才创建强语义叶子。
动态依赖首次解析准确固定；传入绑定冲突失败；同一观察的依赖结果才能用于二次调用。
进展包含 observation 父子、level、唯一 invocation、子 Task 与 Execution，
completed 不等于业务通过，level 完成不等于 attained。

来源授权按原 URL、kind 和 scope 绑定缓存权限，同内容不同来源不能借 digest 绕过授权。
保留非敏感 query 顺序。当前没有凭据 resolver；已识别的凭据型 query 明确拒绝，
不脱敏后伪造可恢复 URL，不在证据中保存签名能力。

## API、包名和历史恢复

包名改为 `@potential-guide/checker-host`，目录仍为 `packages/check-host`，
保留已公开的历史源码导航。内部依赖、包验证、构建和 release 清单改为新名称；
未发布、废弃或创建旧名 npm shim。旧命令 `pguide-check-host` 保留兼容，
新命令为 `pguide-checker-host`；旧环境配置兼容，新 CHECKER 拼写优先，
默认旧私有 discovery 目录保留，避免双 Host。

根导出的旧 CheckTaskClient 仍对应 v2 `{check:…}`；
`@potential-guide/checker-host/v3` 导出同名 CheckTaskClient/CheckTask，
使用新 `{checker:…}` 与语义页面。ObjectiveTaskClient/ProbeTask 提供对称 API。
这显式增加协议版本，不在 v2 偷换字段。SDK 只是 TypeScript 实现，不是协议定义。

新公共模块 `objective-host` 导出服务、Router、SDK 和可选统一 listener。
Pilot service bridge 是显式兼容层：外部无 manifest id，旧业务 `objectiveId`
字段仅携带 `objective:<source URL>`；version 是准确新 digest。
source.kind=`artifact-service-v1`，实际环境和固定依赖另行保存。
Coordinator 请求 schema 3 与 CLI Regulation schema 7 明确承载新来源；
旧请求 schema 1/2 和 CLI schema 4/5/6 的恢复仍用原语义。
运行环境不匹配即拒绝重新绑定，不用“满足最低版本”替代准确运行证据。

完整 HTTP 状态码、入口 lifecycle、profile、兼容操作与使用方式见仓库公开文档，
本文件不替代 Ideal，也不声称 npm、GitHub Release 或外部部署已完成。
