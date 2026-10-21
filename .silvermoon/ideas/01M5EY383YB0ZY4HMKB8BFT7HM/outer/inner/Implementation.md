# Implementation

## Steps

### I-S01: 明确预算与诊断

在 `pilot.probe` 保留 Regulation 外层 `timeoutMs/retry`，新增
`checkTimeoutMs`、`preparationTimeoutMs`、`observationBudget`；统一 probe、regulate、
supervise 绑定及 archived policy。总观察预算包含依赖懒准备，不按依赖重新起算。
诊断保留来源准备、整体截止、深度/次数和单 check 身份，取消等待资源与进程清理。

### I-S02: 减少同轮重复工作

只对明确声明受限只读文件系统契约的来源启用宿主输入视图。宿主采集事实并以第二次
字节遍历校验；进程消费 SHA-256/根路径绑定的整轮不可变视图，不接受 check 自报公共事实。
完整依赖观察按规则/来源、subject、有效语言、模式、runtime 与输入视图复用；
逐请求保留来源、问题证据、目标比较、递归与逻辑次数预算。initial、调用异常、取消及
不稳定输入不充当可复用成功。根观察退出销毁资源，修复与新轮次重新采集。
TypeScript 配置继承、glob 与 alias/module resolution 也绑定同一受限视图宿主；
不得通过 ts.sys 回读实时目标，也不得因继承配置读取失败而静默省略 alias 判断。
无宿主视图的独立包仍读取公共配置及全部包 manifest，但仅展开自身源码 inventory；
未知 workspace pattern 保留全仓 fallback。两条主线不引入 worker、层级并发或主进程业务检查。

### I-S03: 验证收益与行为边界

运行针对性正确性、超时、取消、视图篡改及独立入口测试，生成受版本控制的运行资源；
更新直接相关 API/设置说明并执行 pnpm check。源码实施证据与复现边界见
[Validation.md](./Validation.md)。固定版本真实消费者的冷/热测量由主 Agent 补充，
不把历史不同环境耗时与本轮结果混比。

## Acceptance criteria

### I-AC01: 预算和错误可定位

测试证明三类预算各自生效，配置入口一致；超时携带可识别原因和阶段，取消清理不泄漏进程。

### I-AC02: 减少重复且不复用失效证据

计数与前后对比证明重复工作和耗时减少；反例证明变化、修复、新轮次及异常不产生旧结果
命中，current、问题归属和固定来源保持正确。视图采集后发生的目标变化在下一次根观察
体现，当前整轮只判断同一份不可变输入；不宣称操作系统原子快照或跨轮缓存。

### I-AC03: 校验与说明完整

针对性测试、生成物检查及 pnpm check 通过，直接相关文档说明生命周期、预算及性能测量边界。
