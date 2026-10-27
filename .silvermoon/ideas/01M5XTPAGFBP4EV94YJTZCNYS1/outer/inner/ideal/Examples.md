# 用例示例：state、transition 与返回的 after

本文支持 [构想契约](./Idea.md) 和 [预期行为](./Expected-behavior.md)。
所有文件名、字段、类型与入口均为设计示意，不是已实现或已确定的最终 API。
这一版替代“手写 BDD 树加外置说明”的旧示例。

## 1. 最小文件关系

```text
host.states.yaml       唯一的状态树、绑定 ID 与人工说明
bindings.ts            ID 到真实 transition/检查函数的映射
transitions.ts         调用时进入状态，返回各自的 after
checks.ts              state 上的只读探针
```

测试适配读取 YAML 和注册表；HTML/Markdown/终端输出器只读取 YAML。
不再维护手写 describe/it 树。测试源码可按需生成，也可以在运行时展开。

## 2. 一份 YAML 同时描述结构和说明

下面只展开启动和取消清理路径；其余故障路径按相同结构添加。
before/after 字段是 Markdown 人工说明，不是独立的可执行 hook。

```yaml
namespace: check-host
state:
  id: initial
  title: 尚未建立测试环境
  transitions:
    - id: prepare
      use: environment.prepare
      before: |
        准备独立的 Host 目录、演示 Objective 和控制文件目录。
        记录本次目录及资源所有权；不连接用户默认 Host。
      after: |
        无论检查成功或失败，都先释放遗留的控制屏障。
        确认自有进程退出后删除本场景目录，保留必要的失败诊断。
      state:
        id: isolated
        title: 隔离环境已准备，Host 尚未启动
        transitions:
          - id: connect
            use: host.start
            before: |
              设置本场景的 PGUIDE_CHECK_HOST_DIRECTORY。
              通过 CLI 启动 Host，并通过鉴权 GET /checks 确认就绪。
              仅 PID 存在不表示已经就绪。
            after: |
              停止本次启动并记录的 Host，等待确认退出。
              不停止其他实例，不把描述文件中的 token 写入报告。
            state:
              id: ready
              title: Host 可用
              checks:
                - id: idle
                  use: host.checkIdle
                  title: 活动任务为空
                  doc: 查询 GET /checks，预期 HTTP 200、JSON 空数组。
              transitions:
                - id: start-task
                  use: task.startHeld
                  before: |
                    提交可取消的演示任务，保持执行和清理屏障。
                    记录 checkId，等待已进入执行的进度及 Running 快照。
                  after: |
                    释放本任务可能阻塞的屏障。
                    若任务仍活跃则请求取消，并确认任务资源已收尾。
                  state:
                    id: running
                    title: 任务 Running
                    checks:
                      - id: input
                        use: task.checkInput
                        title: 输入正确且只执行一次
                        doc: 核对当前快照的输入标记、调用计数及活动列表。
                    transitions:
                      - id: cancel
                        use: task.cancel
                        before: |
                          对本次 checkId 发送 POST /checks/{checkId}/cancel。
                          等待 worker 进入延迟清理，保持清理屏障。
                        after: 本步未获得新资源，无额外清理；任务资源由 start-task 收尾。
                        state:
                          id: cancelling
                          title: 任务 Cancelling
                          checks:
                            - id: not-terminal
                              use: task.checkCancelling
                              title: 清理完成前没有终态
                              doc: 确认 Cancelling，清理完成标记尚不存在。
                          transitions:
                            - id: release-cleanup
                              use: task.releaseCleanup
                              before: 释放本次清理屏障，等待任务终态及清理完成标记。
                              after: 本步未获得新资源，无额外清理。
                              state:
                                id: cancelled
                                title: 任务 Cancelled
                                checks:
                                  - id: released
                                    use: task.checkReleased
                                    title: 已取消且资源已释放
                                    doc: |
                                      确认 Cancelled、清理完成标记及活动列表不含该任务。
                                      发出终止请求本身不等于资源已经退出。
```

YAML 中节点 id 与 use 分别表达“这次出现在哪里”和“调用哪个实现”。
最终稳定定位可结合 namespace 与出现路径，不依赖展示标题。
fixture 准备、提交及屏障控制的具体命令在实施阶段补齐，示例不是完整可运行手册。

## 3. 函数注册表示意

```ts
export const transitions = {
  "environment.prepare": prepareEnvironment,
  "host.start": startHost,
  "task.startHeld": startHeldTask,
  "task.cancel": cancelTask,
  "task.releaseCleanup": releaseCleanup,
};

export const checks = {
  "host.checkIdle": checkIdle,
  "task.checkInput": checkInput,
  "task.checkCancelling": checkCancelling,
  "task.checkReleased": checkReleased,
};
```

注册表只是绑定，不再描述树，也不在导入时启动服务。
自动测试入口在执行前验证全部 use 的存在与角色；文档入口完全不导入该注册表。

## 4. 一个 transition 的形态

```ts
type After = () => void | Promise<void>;
type Transition<C> = (context: C) => After | Promise<After>;

const startHost: Transition<Context> = async (context) => {
  const host = await launchOwnedHost(context);
  try {
    await waitForAuthenticatedReadiness(host);
    context.host = host;
  } catch (error) {
    try {
      await stopOwnedHost(host);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "进入失败且清理失败");
    }
    throw error;
  }

  return async () => {
    await stopOwnedHost(host);
  };
};
```

这段代码仅示意资源责任，helper 和 Context 不在此定义。
launchOwnedHost 自身若在返回前失败，也必须负责它已获取的部分资源。
返回 after 的闭包持有确切实例，不在收尾时从可变 context 猜测要停止哪个进程。

取消任务本身不新增资源时，可以返回空操作：

```ts
const cancelTask: Transition<Context> = async (context) => {
  await requestCancellationAndConfirmCleanupEntered(context);
  return () => {};
};
```

这里的空操作是明确的“本步无额外释放责任”，不是清理错误的吞错 fallback。
startHeldTask 仍负责它获得的任务和屏障。

## 5. 自动测试怎样执行一条路径

选择 cancelled state 上的 released 检查，每次运行都重新建立 context：

```text
environment.prepare()    → 保存 after prepare
host.start()             → 保存 after connect
task.startHeld()         → 保存 after start-task
task.cancel()            → 保存 after cancel
task.releaseCleanup()    → 保存 after release-cleanup
task.checkReleased()

after release-cleanup
after cancel
after start-task
after connect
after prepare
```

生成/展开的 Node Test 可以将每层 transition 注册到 beforeEach，
并在对应层收尾时调用这次返回的 after；YAML 不需要出现这些底层 hook 名称。
after 的登记、错误聚合及其他实现细节留待实施阶段确定。

若 host.start 返回前失败：它清理自己的部分初始化，然后执行已登记的 after prepare。
若 task.checkReleased 失败：仍执行全部已登记 after。
若 after start-task 失败：继续 after connect 和 after prepare，并保留所有错误。

ready/idle、running/input、cancelling/not-terminal 是独立测试，
不会自动串到这条路径中；必要前置确认已经由相应 transition 提供。

## 6. 同一 YAML 的人工输出

- state：尚未建立测试环境
  - transition：准备隔离环境
    - state：隔离环境已准备，Host 尚未启动
      - transition：启动并确认 Host
        - state：Host 可用
          - 检查：活动任务为空
          - transition：提交受控任务
            - state：任务 Running
              - 检查：输入正确且只执行一次
              - transition：请求取消
                - state：任务 Cancelling
                  - 检查：清理完成前没有终态
                  - transition：释放清理
                    - state：任务 Cancelled
                      - 检查：已取消且资源已释放

HTML 中选择最后一个检查，展示：

1. prepare、connect、start-task、cancel、release-cleanup 的 before，按进入顺序排列。
2. released 的检查说明。
3. release-cleanup、cancel、start-task、connect、prepare 的 after，按逆序排列。

没有额外清理的步骤明确标注即可，不伪造业务状态回滚。
人工说明必须给出命令、变量来源、完成条件和失败收尾，不能只列函数名。

## 7. 故障与恢复怎么写

在 running state 的 transitions 中再放一个同级分支：

```yaml
- id: crash-worker
  use: task.crashWorker
  before: 通过受控演示入口使目标 worker 退出，确认目标任务 Failed。
  after: 本步无新增资源；保留原任务 ID，任务资源仍由上层转移收尾。
  state:
    id: failed
    title: 任务 Failed，Host 仍可用
    checks:
      - id: explicit-failure
        use: task.checkWorkerFailed
        title: 执行故障明确可见
        doc: 确认任务 Failed，不是业务不通过或永久 Running，Host 仍可响应查询。
    transitions:
      - id: recover
        use: task.executeRecovery
        before: 使用同一 artifact 目录及 revision、新 checkId 执行正常任务。
        after: 清理本次恢复任务可能留下的自有资源。
        state:
          id: recovered
          title: 新任务 Completed
          checks:
            - id: no-replay
              use: task.checkRecovery
              title: 恢复成功且旧任务未重放
              doc: 确认新结果正确、原任务仍为原 Failed，且使用健康执行环境。
```

这是 YAML 数据片段，不是宣称对应函数已经存在。
进入 Failed 是预期的服务状态，不能据此自动阻断恢复分支。

## 8. 之后应证明的行为

| 场景 | 预期 |
| --- | --- |
| HTML 消费同一 YAML | 有完整树与人工路径，不导入注册表，不调用 transition、检查或 after |
| 自动测试消费同一 YAML | 每个检查重新进入路径，正序 transition、逆序 after |
| transition 部分失败 | 本步收尾部分资源，祖先 after 仍执行 |
| 探针失败或某个 after 失败 | 其余清理继续，原始错误与清理错误均可见 |
| 未知 use 或角色不匹配 | 测试入口在业务副作用发生前报错 |
| 重复 YAML 键或歧义节点身份 | 数据校验报错，不少生成一个分支充当成功 |
| 同一 transition 绑定用于多个分支 | 各自持有返回的 after，不共享另一条路径的资源 |
| 修改标题 | 展示文字改变，节点身份及绑定保持稳定 |

以上是预期用例形态，不是本轮已完成的实现或验证记录。
