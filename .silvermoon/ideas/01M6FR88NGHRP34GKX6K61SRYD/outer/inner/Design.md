# Task Run 日志简短设计

这是准备阶段的设计候选，不是已实现 API 或已固定协议。它服务于
[Implementation.md](Implementation.md) 的 I-S01、I-S02、I-S03；构想验收范围仍由
[Idea.md](ideal/Idea.md) 定义。具体限额、协议标识与传输细节在实施阶段确认。

## 范围与链路

同时交付作者侧 Log API、消费侧日志 API 和 Task Engine Web UI 日志界面：

```text
任务回调 context.log(...)
  -> SDK / Worker 日志通道
  -> Engine 校验身份、分配顺序并持久化
  -> 按 Run 查询 / 实时订阅 API
  -> Task Engine Web UI 的 Run 详情 / Logs
```

日志是诊断数据，不是业务 Result、progress、checkpoint 或生命周期事件；
现有 Run diagnostics 和公开事件历史不能代替作者日志。
不自动收集 console、stderr、环境变量或任意子进程输出。

## Worker 作者侧 API：before / after

当前 [RunContext](../../../../../packages/task-protocol/src/run.ts) 提供
`progress(value): Promise<void>` 和 `checkpoint(value): Promise<void>`，没有日志方法。
作者提供默认导出的异步回调，生成入口调用 `runTask`，不直接操作 parentPort。

### Before：现有 SDK 用法

以下来自现有 [echo 回调](../../../../../packages/task-sdk/examples/echo/callback.ts)，
progress 表示执行阶段，Result 只返回业务数据：

```ts
import type { RunContext } from "@potential-guide/task-sdk";

export default async function echo(input: { text: string }, context: RunContext) {
  await context.progress({ stage: "execution", message: "Echoing the supplied text." });
  return { text: input.text };
}
```

如需详细诊断，目前没有独立作者 API。塞入 progress 会混淆业务进度；
塞入 Result 会扩大或改变业务 Schema；console/stderr 不是可查询的 Run 日志历史。

### After：候选 API

沿用 context 方法与异步背压风格，只新增 `log`，原有方法保持原语义：

```ts
type RunLogLevel = "debug" | "info" | "warn" | "error";

interface RunLogInput {
  level: RunLogLevel;
  message: string;
  fields?: JsonObject;
}

type RunLogWriteResult =
  | { state: "stored"; sequence: number }
  | { state: "dropped"; reason: "capacity" | "entry_too_large" }
  | { state: "unavailable"; reason: "disabled" | "storage" | "channel" | "timeout" };

// 新增到 RunContext；JsonObject 使用 task-protocol 的 JSON 类型。
log(value: RunLogInput): Promise<RunLogWriteResult>;
```

Worker 回调示例（使用未来支持日志的新协议 SDK）：

```ts
import type { RunContext } from "@potential-guide/task-sdk";

export default async function echo(input: { text: string }, context: RunContext) {
  await context.progress({ stage: "execution", message: "Echoing the supplied text." });
  await context.log({
    level: "debug",
    message: "开始处理输入。",
    fields: { characterCount: input.text.length },
  });
  const result = { text: input.text };
  await context.log({ level: "info", message: "处理完成。" });
  return result;
}
```

业务 Result 不变，详细日志不再占用 progress。作者不用填写 runId、generation、
时间或序号；SDK 与宿主绑定可信身份。`fields` 只用于作者明确选择的诊断字段，
不默认记录原始输入或敏感内容。输出仍是非可信文本，UI 不按 HTML 渲染。

`stored` 仅在宿主持久化确认后返回；其余回执明确区分丢弃和不可用。
作者可检查回执自行决定业务策略，但日志容量或基础设施故障不会由 SDK 自动抛成任务失败。
上述示例选择让业务继续，缺失状态仍必须在消费 API 和 UI 可见，不能伪装写入成功。
确认超时意味着写入结果未知，不自动重试或声称一定未写入。
无效级别、非 JSON 字段等编程错误以明确的 TaskError 拒绝，不吞掉错误。

## Worker、Engine 与保留边界

- 新协议引入专用日志请求与确认，不原地扩写已固定的
  [Task Bundle v1 协议](../../../../../docs/task-bundle-worker.md)。新旧协议显式区分，
  宿主在运行前检查兼容性；旧 bundle 仍按旧协议执行，UI 显示“不支持日志”，而不是“无日志”。
- 宿主校验 generation、Run 与 scope，对同一 Run 分配单调序号及宿主接收时间。
  顺序以宿主接受顺序为准，不用 Worker 时钟推导跨 Run 顺序。
- 日志队列与必要业务输出隔离。单条字节数、待处理队列、每 Run 总量、全局存储和保留时长
  都设有限上限；await 提供背压，确认等待也有上限，不让日志阻塞取消、最终业务输出或资源回收。
- 容量拒绝更新有界的 Run 日志状态与丢弃计数，不为每条丢弃再生成日志。
  通道失联、取消或强制终止可能导致尾部缺失；宿主标记完整性未知。
  日志已排空不代表 Worker 已退出，日志故障也不改变 Run 的生命周期裁决。
- 日志存储故障与过期在独立可用性元数据中可见；即使状态服务也不可用，API 返回明确错误，
  UI 显示加载失败，不返回成功形状的空日志。保留清理后保留有界的过期状态用于区分从未输出。

## 消费 API 与 Web UI

候选消费接口如下，名称及实时传输方式在实施阶段按既有 HTTP 模式固定：

```ts
client.getRunLogs(runId, { afterSequence, limit });
client.subscribeRunLogs(runId, { afterSequence });
```

查询返回有界的日志页、后续游标与独立日志状态；条目包含
`runId, sequence, receivedAt, level, message, fields?`。
状态至少区分支持但无输出、不支持、禁用、可用、截断、过期及不可用，
并单独表达尾部完整性与丢弃计数。Run 不存在和未授权返回明确错误。
API 复用 Run 读取的身份与 scope 校验；不能仅凭 runId 读取其他调用方的日志。

实时订阅从最后确认序号续接，以序号去重；游标落在已清理区间时显式报告缺口。
首屏历史与订阅之间不能漏条目：以最后读取序号回放后再跟随实时输出。
慢消费者使用有界缓冲，溢出或断连明确通知，由客户端按游标补读；
实时订阅不是无限内存队列，也不承诺任意旧序号永久可回放。

在 [Task Engine Web UI](../../../../../apps/task-engine-web-ui) 的 Run 详情增加独立
Logs 区域，与 Result、progress 和现有事件历史分开：

- 显示时间、级别、完整保留的 message 和展开的结构化 fields；当前 Run 身份始终可见。
- 执行中支持实时跟随与暂停跟随，结束后仍可分页查看历史；暂停或长列表不造成浏览器无限增长。
- 切换 Run 关闭旧订阅并隔离迟到响应；重新连接按序号补读，不混入并发 Run 输出。
- 无日志、不支持、加载失败、截断、过期、断连及尾部完整性未知有不同提示。
  业务成功不意味着诊断日志完整。

## 最小验证

I-AC01 验证同一真实 SDK bundle 的日志与精简 Result 分离；
I-AC02 验证 HTTP、历史/实时衔接及 Web UI 按 Run 隔离；
I-AC03 验证失败、取消、强制停止、容量、存储故障与慢消费者下资源有界且缺失可见。
这些是实施期验证计划，不是本次文档更新已经通过的运行证据。
