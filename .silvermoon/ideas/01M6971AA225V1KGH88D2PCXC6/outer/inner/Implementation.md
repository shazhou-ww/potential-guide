# Implementation

这是准备阶段的轻量初版，不代表已经授权实施。清理证据与范围以[分析](./ideal/Analysis.md)为依据；实施开始时重新核对当前代码及其他 session 的收藏适配成果。

## Steps

### I-S01: 收敛协议与单版本注册

移除历史更新元数据回补及旧 Task 阶段例外，要求当前记录完整；将 Engine、Host 配置、discovery、recurrence 和测试夹具统一为每种 type 单个当前注册。保留 version、contractRevision、环境、scope 和 HTTP revision guard 的身份约束。

### I-S02: 清理新链路残留并联动消费者

清理只为旧 direct adapter 留下的可选 context 声明及恒真条件，统一 Check/Probe 当前注册与内部绑定身份；保留仍被业务资源池使用的准备、分配、执行接口和 checkpoint/结果复验。UI 只对当前 Task 阶段进行校验；收藏部分不与另一 session 重复改造。

### I-S03: 对齐验证与说明

更新相关测试、README、链路文档和验证脚本。先运行受影响 workspace 的 build/typecheck/test 与直接相关脚本，再运行 `pnpm check`；不以删除旧拒绝测试替代当前输入和故障行为证明。

## Acceptance criteria

### I-AC01: 只接受当前契约

测试证明同 type 重复注册明确失败，discovery 与执行使用唯一注册；缺失更新元数据及旧阶段不能回补或通过投影。旧数据库、错误契约身份和旧请求不能被当作当前成功，拒绝路径不得自动迁移或清空文件。

### I-AC02: 保留当前运行可靠性

相关现有及新增测试证明：当前版本结果和 checkpoint 可在重启后复验；未可靠终结的 Run 不自动重跑；共享、recurrence、取消、消息幂等/未知、代际隔离和真实资源释放证明保持有效。PreparationOptions 的可信 context 必须在全部当前调用处完整传入。

### I-AC03: 所有直接消费者一致

受影响 workspace、fixture、配置样例及脚本不再传 currentVersions 或依赖旧阶段/回补接口；API、包依赖、类型检查及 `pnpm check` 通过。保存可重现命令及结果于本世界必要的验证证据，收藏适配以另一 session 的实际合入结果为准。
