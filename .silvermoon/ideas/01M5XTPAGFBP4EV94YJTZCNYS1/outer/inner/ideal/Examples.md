# 用例示例：一个 Binding TS 与固定命名

本文支持 [构想契约](./Idea.md) 和 [预期行为](./Expected-behavior.md)。
所有文件名、字段、类型与入口均为设计示意，不是已实现的 API。
这一版移除逐项 use、独立 transition ID 和手写注册表。

## 1. 最小文件关系

```text
host.states.yaml       唯一的状态树、人工说明及一个 binding 路径
host.binding.ts        按约定命名导出 transition 与检查函数
transitions.ts         调用时进入状态，返回各自的 after
checks.ts              state 上的只读探针
```

后两个文件可按需拆分，不要求每个函数单独一个文件。
测试适配读取 YAML、导入 Binding TS；文档输出器只读取 YAML。
binding 相对于 YAML 文件所在目录解析，不能受运行命令时的 cwd 影响。

## 2. 一份 YAML

state 自带进入和收尾的人工说明；函数名由 state ID 推导。
before/after 字段是 Markdown 文本，不是两条独立 hook 的函数名。

```yaml
namespace: check-host
binding: ./host.binding.ts
state:
  id: isolated
  title: 隔离环境已准备，Host 尚未启动
  before: |
    准备独立的 Host 目录、演示 Objective 和控制文件目录。
    记录本次目录及资源所有权，不连接用户默认 Host。
  after: |
    释放遗留的控制屏障，确认自有进程退出后删除本场景目录。
    保留必要的失败诊断，不暴露凭据。
  states:
    - id: ready
      title: Host 可用
      before: |
        设置本场景的 PGUIDE_CHECK_HOST_DIRECTORY。
        通过 CLI 启动 Host，并通过鉴权 GET /checks 确认就绪。
        仅 PID 存在不表示已经就绪。
      after: 停止本次启动并记录的 Host，等待确认退出，不停止其他实例。
      checks:
        - id: idle
          title: 活动任务为空
          doc: 查询 GET /checks，预期 HTTP 200、JSON 空数组。
      states:
        - id: running
          title: 任务 Running
          before: |
            提交可取消的演示任务，保持执行和清理屏障。
            记录 checkId，等待已进入执行的进度及 Running 快照。
          after: |
            释放本任务可能阻塞的屏障。
            若任务仍活跃则请求取消，并确认任务资源已收尾。
          checks:
            - id: input
              title: 输入正确且只执行一次
              doc: 核对当前快照的输入标记、调用计数及活动列表。
          states:
            - id: cancelling
              title: 任务 Cancelling
              before: |
                对本次 checkId 发送 POST /checks/{checkId}/cancel。
                等待 worker 进入延迟清理，保持清理屏障。
              after: 本步未获得新资源，无额外清理；任务资源由进入 running 的转移收尾。
              checks:
                - id: waiting
                  title: 清理完成前没有终态
                  doc: 确认 Cancelling，清理完成标记尚不存在。
              states:
                - id: cancelled
                  title: 任务 Cancelled
                  before: 释放本次清理屏障，等待任务终态及清理完成标记。
                  after: 本步未获得新资源，无额外清理。
                  checks:
                    - id: released
                      title: 已取消且资源已释放
                      doc: |
                        确认 Cancelled、清理完成标记及活动列表不含该任务。
                        发出终止请求本身不等于资源已经退出。
```

根 state 的 transition 建立初始 fixture；每个子 state 的 transition
从其父状态进入当前状态。state ID 在本 YAML 内唯一，检查 ID 在 state 内唯一。
示例 ID 仅使用以 ASCII 字母开头的字母数字串，不做短横线或下划线的隐式转换。
标题可自由使用自然语言；具体 fixture 命令在实施阶段补齐。

## 3. 固定关联规则

| YAML 位置 | 预期导出函数 |
| --- | --- |
| state isolated | `transition_isolated` |
| state ready | `transition_ready` |
| ready 的 idle 检查 | `check_ready_idle` |
| state running | `transition_running` |
| running 的 input 检查 | `check_running_input` |
| state cancelling | `transition_cancelling` |
| cancelling 的 waiting 检查 | `check_cancelling_waiting` |
| state cancelled | `transition_cancelled` |
| cancelled 的 released 检查 | `check_cancelled_released` |

规则只有两条：

- 进入 state S：调用 `transition_S(context)`，保存返回的 after。
- 检查 state S 上的 C：调用 `check_S_C(context)`。

**没有单独的 `after_S` 导出。** after 由 transition 返回闭包；
YAML 的 after 文本描述这个返回值负责的收尾。
改标题不改变绑定；改 ID 会改变预期函数名，必须同步修改导出。

## 4. Binding TS 示意

Binding TS 可以直接定义函数，也可以从实现模块重新导出，省去注册表：

```ts
export {
  prepareEnvironment as transition_isolated,
  startHost as transition_ready,
  startHeldTask as transition_running,
  cancelTask as transition_cancelling,
  releaseCleanup as transition_cancelled,
} from "./transitions.js";

export {
  checkIdle as check_ready_idle,
  checkInput as check_running_input,
  checkCancelling as check_cancelling_waiting,
  checkReleased as check_cancelled_released,
} from "./checks.js";
```

实现模块导入时不能创建 fixture 或启动服务。
不同 state 复用同一实现时，可以用不同导出别名；每次调用仍产生自己的资源和 after。
测试入口应一次检查所有预期导出存在且为函数，在进入任何状态之前报告缺失；
不要用“找不到就当空操作”容错。transition 返回 after 的契约在调用时验证。

## 5. transition 与 after 的形态

下面是一个可由 Binding TS 直接导出的函数形态，helper 与 Context 仅作示意：

```ts
type After = () => void | Promise<void>;
type Transition<C> = (context: C) => After | Promise<After>;

export async function transition_ready(context: Context): Promise<After> {
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
}
```

返回 after 的闭包持有确切实例，不在收尾时从可变 context 猜测要停止哪个进程。
launchOwnedHost 若在返回前失败，也必须处理它自己已获取的部分资源。
没有新增资源的 transition 可以显式返回 `() => {}`，但不能捕获清理错误后返回空操作。

## 6. 自动路径与人工路径

选中 cancelled state 的 released 检查，每次自动测试都重新建立 context：

```text
transition_isolated()    → 保存 after isolated
transition_ready()       → 保存 after ready
transition_running()     → 保存 after running
transition_cancelling()  → 保存 after cancelling
transition_cancelled()   → 保存 after cancelled
check_cancelled_released()

after cancelled
after cancelling
after running
after ready
after isolated
```

HTML 或 Markdown 的人工手册展示同一顺序：

1. isolated、ready、running、cancelling、cancelled 的 before 说明。
2. released 的检查说明。
3. cancelled、cancelling、running、ready、isolated 的 after 说明。

ready/idle、running/input、cancelling/waiting 是其他独立检查，
不自动加入这份路径；必要准入确认在 transition 及对应 before 说明中完成。
清理不是业务状态回滚，没有新增资源的步骤明确标注即可。

## 7. 故障恢复分支也不需要 use

在 running 的 states 中增加一个同级分支：

```yaml
- id: failed
  title: 任务 Failed，Host 仍可用
  before: 通过受控演示入口使目标 worker 退出，确认目标任务 Failed。
  after: 本步无新增资源，任务资源仍由进入 running 的转移收尾。
  checks:
    - id: fault
      title: 执行故障明确可见
      doc: 确认任务 Failed，不是业务不通过或永久 Running，Host 仍响应查询。
  states:
    - id: recovered
      title: 新任务 Completed
      before: 使用同一 artifact 目录及 revision、新 checkId 执行正常任务。
      after: 清理本次恢复任务可能留下的自有资源。
      checks:
        - id: noReplay
          title: 恢复成功且旧任务未重放
          doc: 确认新结果正确、原任务仍为原 Failed，且使用健康执行环境。
```

对应导出自动推导为 `transition_failed`、`check_failed_fault`、
`transition_recovered`、`check_recovered_noReplay`。
这是设计片段，不表示函数已实现；成功进入 Failed 不应阻断恢复路径。

## 8. 之后应证明的行为

| 场景 | 预期 |
| --- | --- |
| YAML 只声明一个 binding 文件 | 按固定命名解析全部 state 和检查，无逐项映射或注册表 |
| 改变运行 cwd | binding 仍相对于 YAML 文件解析 |
| 缺少 check_ready_idle 或导出不是函数 | 测试入口在执行 transition 前明确报错 |
| transition 未返回 after | 报告契约错误，不悄悄补空操作 |
| HTML 消费同一 YAML | 有完整树与人工路径，不导入 Binding TS，不调用任何测试函数 |
| 自动测试消费同一 YAML | 每个检查重新进入路径，正序 transition、逆序 after |
| 部分进入、探针或某个 after 失败 | 其他应执行的收尾继续，原始错误与清理错误均可见 |
| state ID 重复或 ID 含歧义字符 | 校验报错，不靠转换名称或静默选一个绑定 |
| 仅修改展示标题 | 节点身份及函数绑定保持稳定 |

以上是预期用例形态，不是本轮已完成的实现或验证记录。
