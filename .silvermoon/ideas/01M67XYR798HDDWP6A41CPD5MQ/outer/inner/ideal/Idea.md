# 将准备纳入完整 Execution 复用

## 问题

当前 Prepare 属于各个 Task，而共享对象只包含后续 Execution，容易把准备完成误作共享资格，
并为绕过该前提引入通用 TaskType.authorize。详见 [讨论](./Discussion.md)。

## 结果

Task 表达需求，Execution 承担包含准备的完整尝试；共享资格不依赖接收 Task 的 Prepared，
由 Input、Execution Match Policy 及可信共享边界决定。Engine 只面向类型执行边界，
不理解类型内部的具体工作调度。

## 边界

1. 准备是 Execution 子阶段；明确整个过程的 start/terminate 边界，保持独立取消、超时和物理回收语义。
2. 浮动 URL 不承诺最新内容；匹配原始 Input，实际内容可追溯，需要固定版本时在 Input pin digest。
3. 去掉通用 TaskType.authorize，保留服务访问、实际资源动作和资源替换边界。
   Worker 按信任边界或真实多线程并行需求切分；Engine、TaskType 与跨信任边界的定制工作
   不混在同一 Worker。具体安全机制另行定界，不把 Node Worker 等同安全沙箱，
   不改变关联 Idea 的生命周期或验收。

## 验收标准

1. 兼容需求可共享完整准备与执行过程，接收方无需独立准备；准备失败具有明确的 Execution 终结语义。
2. 两种 Match Policy 对完整过程具有明确事件边界；浮动引用复用旧内容不被误判为不兼容或最新内容。
3. 匹配不再逐 Task 授权资源；实际资源动作及服务访问仍受可信权限约束，
   类型动态代码不在 Engine 内运行，类型内部调度与物理 Worker 复用不成为 Engine 的业务知识。
