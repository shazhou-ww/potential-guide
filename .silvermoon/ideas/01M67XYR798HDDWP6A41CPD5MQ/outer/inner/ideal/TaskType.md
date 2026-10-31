# TaskType 最简接口与 Progress 草案

本文支持 [构想契约](./Idea.md)。用户要求记录修剪后的接口并明确 Progress 上报方式；
以下签名及确认时点是设计候选，不是已批准的实现。JsonSchema 是概念占位名，
不是仓库当前已有的通用 schema 类型；实际采用范围须沿用并核对现有协议能力。

## 接口候选

```ts
interface TaskType<Input extends Json = Json, Result extends Json = Json> {
  type: string;
  version: string;
  inputSchema: JsonSchema;
  resultSchema: JsonSchema;

  run(input: Input, context: RunContext): Promise<Result>;
}

interface RunContext {
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly scope: string;

  progress(value: Json): Promise<void>;
}
```

TaskType 只声明公开 Input、最终 Result 与完整运行入口。Prepared 不再是 TaskType 泛型，
也不是 run 的前置参数；它可作为类型内部的对象和可报告的中间信息存在。
跨 Worker 的 Input 和消息使用隔离副本，禁止携带 Engine 内部引用或共享可变内存。
RunContext 在类型 Worker 本地构造，signal 和 progress 并不是从 Engine 直接复制的对象或函数。
scope 由可信宿主提供，不来自请求正文，也不意味着插件可以自行授予资源权限。

环境、容量及可信资源能力由宿主注册与类型装配配置，不由 TaskType 插件自授。
这一接口没有列出 Check 下载/资源池等能力：它们由类型实现通过受控桥接获得，
不将业务专有资源 API 塞进每个 TaskType 的通用 RunContext。
MatchPolicy / matchPolicy 属于 Task 的需求，与 TaskType 的公开 Input 契约分开。

## Progress 上报

使用明确的 context.progress(value)，替换早期草案含糊的 report 名称。
run 返回值表示最终 Result；progress 表示任意数量的中间进度，不返回最终结果，
也不声明通用 Preparation/Allocation 状态机。

```ts
async function run(input: CheckInput, context: RunContext): Promise<CheckResult> {
  const prepared = await prepareChecker(input, context.signal);
  await context.progress({
    kind: "prepared",
    checker: prepared.reference,
  });

  return await runChecker(prepared, {
    signal: context.signal,
    progress: (value) => context.progress(value),
  });
}
```

示例中的 CheckInput、CheckResult、prepareChecker、runChecker 是业务占位名，
不是对现有函数签名的修改。只报告可公开且必要的准备摘要，不把完整 Bundle 字节、
凭据、资源句柄或类型内部状态作为 Progress 默认传递。
Checker 子 Worker 的进度先经类型 Worker 转发，再由 Run 通道交给 Engine；
业务实现应等待、限流或有界缓冲，不能产生无界待确认消息。
stdout/stderr 是诊断输出，不是 Progress 协议。

消息路径：

```text
具体工作 Worker
  -> 类型 Worker 内的 context.progress(JSON)
  -> 指定 Run 的消息通道
  -> Engine 校验并接纳 Run progress 事实
  -> 当前接收该 Run 进度的 Task / 订阅
```

同类型 Worker 可以管理多个 Run，不能用“该 Worker 最近的任务”归属 Progress。
通道必须绑定 runId 和类型 Worker 代际；消息关联、顺序及确认由运行协议控制，
插件不能自定事实时间、事件序号或给另一个 Run 注入进度。
Run 终结后、旧代际或失联通道的 Progress 不得更新当前状态，应显式拒绝。
取消请求与终结不同；取消后的消息处理还须对齐共享需求及 Run 生命周期。

Promise<void> 的候选含义是：Engine 已校验并持久化接纳该 Progress 后确认，
不是 postMessage 成功就通过。持久化失败、非法 JSON、超限、通道关闭等均显式拒绝；
类型实现不得吞掉拒绝后继续把上报当作成功。确认不保证订阅者已经收到，
也不承诺跨 Crash 的 exactly-once。具体消息格式、在途容量及重试规则待定。

Engine 只验证通用有限 JSON、载荷大小、身份、代际、顺序与生命周期约束；
业务进度结构由类型负责，不再调用 TaskType.validateProgress。
Prepared 可以用上述 Progress 报告，但报告摘要不自动变成恢复 checkpoint，
更不自动获得恢复调用栈或重新执行副作用的授权。

## 当前接口的职责修剪

| 当前成员 | 候选处置 |
| --- | --- |
| authorize | 删除通用 hook，保留服务访问与实际资源动作授权 |
| prepare、validatePrepared、Prepared 泛型 | 移至类型实现内部，不由 Engine 编排 |
| execute | 替换为接收 Input 的完整 run 入口 |
| validateProgress | 移至类型内部；Engine 保留通用消息检查 |
| validateResult | 公开结构由 resultSchema 声明，业务语义在类型边界验证 |
| validateExecutionResult | 不再作为 Engine 内的同步动态回调；保留所需业务复验能力 |
| allocationLimit、environment | 归可信宿主注册与运行配置 |

resultSchema 是最终公开结果契约，不是 Run 内部阶段接口；只靠 JSON 检查不足以保留
现有最终结果的结构约束。但 schema 不能替代 Check/Probe 的 Bundle、声明问题及因果证据校验。
这些校验须在类型隔离边界内保留；历史读取/恢复所需的复验如何走类型通道仍待定义，
不能因为删除旧回调就把结构合法当作业务证据有效。

Run 开始/终结事实、取消确认和物理清理不由 progress 伪装。
run 的 Promise 完成与清理确认如何衔接、错误事实如何编码、类型守护 Worker 的启动/关闭接口，
均属于待细化的运行协议；不把当前最简草案当作已经覆盖全部生命周期的实现。
