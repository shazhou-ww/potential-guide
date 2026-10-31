# TaskType 最简接口与 Progress 草案

本文支持 [构想契约](./Idea.md)。用户要求记录修剪后的接口并明确 Progress 上报方式，
随后确认按阶段、可选百分比和文本消息更新设计；这不等于接受本构想的精确 revision。
用户于 11:57 确认 messageSchema 与 messages 必选，不需要业务消息时显式使用 false schema。
完整 TaskType 签名及确认时点仍是设计候选。JsonSchema 是概念占位名，
不是仓库当前已有的通用 schema 类型；Message Schema 须支持 boolean schema，
不能直接照搬当前要求根 type 为 object 的 Input Schema 编译入口。

## 接口候选

```ts
type MessageSchema = boolean | JsonObject;

interface TaskType<
  Input extends Json = Json,
  Result extends Json = Json,
  Message extends Json = never,
> {
  type: string;
  version: string;
  inputSchema: JsonSchema;
  resultSchema: JsonSchema;
  messageSchema: MessageSchema;

  run(input: Input, context: RunContext<Message>): Promise<Result>;
}

interface RunContext<Message extends Json = never> {
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly scope: string;

  progress(value: RunProgress): Promise<void>;
  readonly messages: AsyncIterable<RunMessage<Message>>;
}

interface RunMessage<Message extends Json> {
  readonly messageId: string;
  readonly taskId: string;
  readonly caller: Readonly<Caller>;
  readonly payload: Message;
}

interface RunProgress {
  stage: "preparation" | "allocation" | "execution";
  percent?: number;
  message: string;
}
```

TaskType 声明公开 Input、最终 Result、必选 Message 契约与完整运行入口。Prepared 不再是 TaskType 泛型，
也不是 run 的前置参数；它作为类型内部对象存在，必要的内容身份/恢复证据另行定界，
不作为通用 Progress 的任意 JSON payload。
跨 Worker 的 Input 和消息使用隔离副本，禁止携带 Engine 内部引用或共享可变内存。
RunContext 在类型 Worker 本地构造，signal 和 progress 并不是从 Engine 直接复制的对象或函数。
scope 由可信宿主提供，不来自请求正文，也不意味着插件可以自行授予资源权限。

环境、容量及可信资源能力由宿主注册与类型装配配置，不由 TaskType 插件自授。
这一接口没有列出 Check 下载/资源池等能力：它们由类型实现通过受控桥接获得，
不将业务专有资源 API 塞进每个 TaskType 的通用 RunContext。
MatchPolicy / matchPolicy 属于 Task 的需求，与 TaskType 的公开 Input 契约分开。
messageSchema 和 messages 均必选，不省略字段或通道。
不需要业务消息的类型显式声明 messageSchema: false，Message 泛型使用 never；
false 是标准 JSON Schema，拒绝任意值，包括空对象和 null。{} 或 true 则接受任意 JSON，
不能用空 schema 冒充 Never。messages 的 AsyncIterable 是候选本地消费形式，
取出消息不代表业务接纳，接纳/拒绝确认和持久化协议仍需另行定义。
Caller 是可信服务身份的最小副本，不是 Agent 操作权限或 TaskType 自授权依据。
详见 [运行消息](./Messages.md)，该信封不是无归属的任意 JSON 广播。
Never 类型仍有统一通道，但所有业务 payload 在校验阶段被拒绝，不投递给类型；
没有业务消息不代表自动结束运行通道，通道关闭仍遵循 Run 生命周期。

## Progress 上报

使用明确的 context.progress(value)，替换早期草案含糊的 report 名称。
run 返回值表示最终 Result；progress 表示任意数量的中间进度，不返回最终结果。
阶段字段用于统一展示，不让 Engine 根据 Progress 编排 Preparation/Allocation 状态机。

stage 使用名词 preparation、allocation、execution；percent 是当前阶段的预估百分比，
不是 Run 总百分比。传入时须为有限的 0–100 数值，不传表示未知而不是 0。
进入下一阶段可重新从低百分比开始，类型不必经历或报告全部阶段，
也不必先上报上一阶段 100 才能切换。100 不表示 Run 已成功或资源已释放。
同阶段估计是否需要修订不能由 Engine 擅自加单调增长约束。

message 是任意展示文本，不是机器判定、资源标识或控制指令。
允许空文本；具体字符串长度/消息字节上限由通用协议约束定义，不新增每类型动态校验。
Progress 整体是标准化 JSON 对象，但 message 不换成任意 JSON data，
也不默认新增任意 data 字段或让消费端 JSON.parse(message)。

```ts
async function run(input: CheckInput, context: RunContext): Promise<CheckResult> {
  const prepared = await prepareChecker(input, context.signal);
  await context.progress({
    stage: "preparation",
    percent: 100,
    message: "Checker 准备完成",
  });

  await context.progress({
    stage: "allocation",
    message: "等待可用的 Checker Worker",
  });

  return await allocateAndRunChecker(prepared, {
    signal: context.signal,
    progress: (value) =>
      context.progress({
        stage: "execution",
        message: value.message,
      }),
  });
}
```

示例中的 CheckInput、CheckResult、prepareChecker、allocateAndRunChecker 是业务占位名，
不是对现有函数签名的修改；子工作进度适配须显式映射为标准结构。
只报告可公开且必要的展示信息，不把完整 Bundle 字节、
凭据、资源句柄或类型内部状态作为 Progress 默认传递。
Checker 子 Worker 的进度先经类型 Worker 转发，再由 Run 通道交给 Engine；
业务实现应等待、限流或有界缓冲，不能产生无界待确认消息。
stdout/stderr 是诊断输出，不是 Progress 协议。

消息路径：

```text
具体工作 Worker
  -> 类型 Worker 内的 context.progress(RunProgress)
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
不是 postMessage 成功就通过。持久化失败、非法结构/JSON、超限、通道关闭等均显式拒绝；
类型实现不得吞掉拒绝后继续把上报当作成功。确认不保证订阅者已经收到，
也不承诺跨 Crash 的 exactly-once。具体消息格式、在途容量及重试规则待定。

Engine 验证标准 RunProgress 结构、枚举阶段、可选百分比、字符串消息，以及载荷大小、
身份、代际、顺序与生命周期约束；不再调用 TaskType.validateProgress。
业务语义和展示文本由类型负责，阶段/百分比不参与 Match Policy 或决定 Run 终结。
取消请求、成功、失败及清理确认仍走明确生命周期通道，不用额外 Progress 阶段替代。

Prepared、Bundle digest、因果证据等机器可读内容不是展示 Progress。
不将它们转成 message 后冒充原有结构化信息，也不把准备完成的 Progress 当作 checkpoint。
这些信息可留在类型内部，或在确有公开/持久化需要时进入明确的业务结果/证据契约；
具体路径仍待定义，需保留现有消费者所需的内容追溯和历史复验能力。
Progress 不授予恢复调用栈或重新执行副作用的能力。

## 当前接口的职责修剪

| 当前成员 | 候选处置 |
| --- | --- |
| authorize | 删除通用 hook，保留服务访问与实际资源动作授权 |
| prepare、validatePrepared、Prepared 泛型 | 移至类型实现内部，不由 Engine 编排 |
| execute | 替换为接收 Input 的完整 run 入口 |
| validateProgress | 删除注入回调；Engine 统一校验 RunProgress，类型负责业务语义 |
| validateResult | 公开结构由 resultSchema 声明，业务语义在类型边界验证 |
| validateExecutionResult | 不再作为 Engine 内的同步动态回调；保留所需业务复验能力 |
| allocationLimit、environment | 归可信宿主注册与运行配置 |

resultSchema 是最终公开结果契约，不是 Run 内部阶段接口；只靠 JSON 检查不足以保留
现有最终结果的结构约束。但 schema 不能替代 Check/Probe 的 Bundle、声明问题及因果证据校验。
这些校验须在类型隔离边界内保留；历史读取/恢复所需的复验如何走类型通道仍待定义，
不能因为删除旧回调就把结构合法当作业务证据有效。

Run 开始/终结事实、取消确认和物理清理不由 progress 伪装。
业务输入 Message 也不由 Progress 的 message 字符串承载；
Check 不需要输入消息时显式声明 messageSchema: false，不增加空对象占位消息；
messages 仍必选。Cancel 是独立生命周期控制，不被 Never Message Schema 禁用。
run 的 Promise 完成与清理确认如何衔接、错误事实如何编码、类型守护 Worker 的启动/关闭接口，
均属于待细化的运行协议；不把当前最简草案当作已经覆盖全部生命周期的实现。
