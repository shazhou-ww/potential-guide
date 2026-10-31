# 将准备与分配纳入完整 Run 复用

## 问题

当前 Prepare 属于各个 Task，而共享对象只包含后续 Execution，容易把准备完成误作共享资格，
并为绕过该前提引入通用 TaskType.authorize。详见 [讨论](./Discussion.md)；
[TaskType 与 Progress 草案](./TaskType.md) 和 [运行消息](./Messages.md) 提供接口可行性及待定边界。

## 结果

Task 表达需求，Run 承担包含 Preparation、Allocation 和 Execution 的完整尝试；
共享资格不依赖接收 Task 的 Prepared，由 Input、Match Policy 及可信共享边界决定。
协议采用 MatchPolicy / matchPolicy 命名。Engine 只面向类型执行边界，
不理解类型内部的具体工作调度。

## 边界

1. Run 是可复用单元，Execution 仅指实际执行子过程；明确 Run 的 start/terminate 边界，
   保持独立取消、超时和物理回收语义。类型消息契约与通道必选，无需消息时使用 false schema；
   消息保留 Task 归属与接纳确认，
   不直接改写初始 Input、延长期限或复活已终结 Run。
2. 浮动 URL 不承诺最新内容；匹配原始 Input，实际内容可追溯，需要固定版本时在 Input pin digest。
3. 去掉通用 TaskType.authorize，保留服务访问、实际资源动作和资源替换边界。
   Worker 按信任边界或真实多线程并行需求切分；Engine、TaskType 与跨信任边界的定制工作
   不混在同一 Worker，以独立内存状态和最小消息接口避免相互干涉；不要求完整安全沙箱，
   不改变关联 Idea 的生命周期或验收。

## 验收标准

1. 兼容需求可共享完整 Run，接收方无需独立准备；准备及分配失败具有明确的 Run 终结语义。
2. MatchPolicy 的 started-after-eligible / terminated-after-eligible 指向 Run 事件，
   不指内部 Execution；浮动引用复用旧内容不被误判为不兼容或最新内容。
3. 匹配不再逐 Task 授权资源；实际资源动作及服务访问仍受可信权限约束，
   类型动态代码不在 Engine 内运行。消息的接纳及共享影响可追溯，Never schema 拒绝全部业务消息，
   不用无归属消息覆盖其他需求；类型内部调度与资源复用不成为 Engine 的业务知识。
