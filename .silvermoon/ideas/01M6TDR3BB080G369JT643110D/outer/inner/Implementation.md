# Implementation

## Steps

### I-S01: 明确结果契约与版本绑定边界

梳理当前 Check SDK 及实际检查入口，确定节点级 documentation 的语言映射、引用格式与兼容迁移方式。明确可信执行 Bundle 身份如何进入公共装配流程，避免在 Bundle 构建内容中嵌入自身最终 CID 的循环依赖。

采用 `documentation: { "<language>": "ipfs://<CID>/resources/references/..." }`，结果指向 `check.md`，问题指向 `problems/<code>.md`。`prepareCheck` 从同一 YAML 生成冻结的 `problemCodes` 与 `languages`，供契约与适配器共同导入；保留原有资源覆盖及字节校验。

### I-S02: 接入公共装配与相关检查

复用已有声明和文档覆盖校验，升级结果 Schema、类型、运行时装配及相关 Check 入口，自动提供全部语言的检查和问题引用；同步直接相关的消费接口与文档。

Task SDK 将现有受信 Worker 配置中的已验证执行根暴露为只读 `context.bundle.cid`。Check 适配器在业务观测完成后装配完整 URI；Bundle 内只保存语言、代码及相对资源，绝不嵌入自身最终 CID。Engine 的身份验证、ready 握手及通用结果校验不变，也不解释问题代码。

观测类型为不含文档的 `CheckObservation`；`CheckProblem` 与 `CheckResult` 均要求文档。`createCheckContract`/`createCheckTask` 新增生成的语言参数；直接 `createCheckResult` 或环境库 `check*` 调用必须提供实际已验证 Bundle 的显式身份。直接调用方承担身份真实性责任，不将其声明误当作 Engine 证明。

### I-S03: 验证契约与既有行为

补充通过、未通过、多问题、多语言、版本一致性及故障边界测试，执行针对性验证和仓库要求的 pnpm check。

验收依据见 [Evidence.md](Evidence.md)。文档只由调用方按需读取；装配不读取资源、不吞异常，保留回调上下文、日志、清理及取消对象身份。无文档、错误身份和未声明代码均显式报错，不降级成相对链接、移动版本或检查问题。

## 兼容性与范围

这是严格结果契约及作者 API 的破坏性变更，契约与 Worker 必须一起重新构建、分发新 CAR/CID。现有不可变 Bundle、历史 `check-artifacts` 和 Objective payload 保持原状，不作隐式迁移。三个当前环境 Bundle 均声明 `en`；通用 SDK 使用双语言独立脚手架验证完整覆盖。旧 Objective 的版本比较与目录写探针接口不变，不恢复旧 Host。

## Acceptance criteria

### I-AC01: 节点级引用与契约一致

通过契约和运行时测试证明 result 以及每个 problem 的 documentation 均覆盖全部声明语言，且指向正确页面；通过结果仍不返回 problems。

### I-AC02: 引用与执行身份一致

通过构建与执行集成测试证明引用对应实际执行的不可变 Bundle，单独传递节点仍可解析，且无需业务检查手写 CID 或调用方按 code 查索引。

### I-AC03: 故障边界与既有行为保留

通过回归测试证明 target、code、actual 和检查判断语义保持，执行故障不伪装成 problem，文档读取失败不改写结论；相关测试及 pnpm check 通过。
