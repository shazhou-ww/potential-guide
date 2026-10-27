# 用例与输出示例

本文支持 [构想契约](./Idea.md) 和 [预期行为](./Expected-behavior.md)。
所有文件名、API 与文档命令均为设计示意，尚未实现或确定为最终接口。
示例只展开取消清理与故障恢复两条路径，不是完整 Check Host 测试清单。

## 1. 内容怎样并列组织

```text
测试区域
├── host.tree.test.ts       BDD 结构与真实函数绑定
├── host.manual.yaml        标题、人工操作及检查说明
└── helpers
    ├── environment.ts      隔离环境和自有资源收尾
    ├── transitions.ts      状态转移及必要的准入确认
    └── checks.ts           只读探针
```

封装及渲染工具的包归属留待实施阶段决定，不在本例约定。
实现模块导入时不能创建 fixture 或启动服务。

## 2. 树文件示意

```ts
import { afterEach, beforeEach, describe, it, loadManual } from "./tree-bdd.js";
import { createEnvironment, disposeEnvironment } from "./helpers/environment.js";
import {
  connectThroughCli,
  startHeldTask,
  cancelTask,
  releaseCleanup,
  crashWorker,
  executeRecoveryTask,
} from "./helpers/transitions.js";
import {
  checkReady,
  checkRunning,
  checkCancelling,
  checkResourcesReleased,
  checkWorkerFailed,
  checkRecoveryCompleted,
} from "./helpers/checks.js";

const m = loadManual(new URL("./host.manual.yaml", import.meta.url));

describe(m.environment, () => {
  beforeEach(createEnvironment, m.prepare);
  afterEach(disposeEnvironment, m.dispose);

  describe(m.ready, () => {
    beforeEach(connectThroughCli, m.connect);
    it(m.readyProbe, checkReady);

    describe(m.running, () => {
      beforeEach(startHeldTask, m.start);
      it(m.runningProbe, checkRunning);

      describe(m.cancelling, () => {
        beforeEach(cancelTask, m.cancel);
        it(m.cancellingProbe, checkCancelling);

        describe(m.cancelled, () => {
          beforeEach(releaseCleanup, m.release);
          it(m.cleanupProbe, checkResourcesReleased);
        });
      });

      describe(m.workerFailed, () => {
        beforeEach(crashWorker, m.crash);
        it(m.failureProbe, checkWorkerFailed);

        describe(m.recovered, () => {
          beforeEach(executeRecoveryTask, m.recover);
          it(m.recoveryProbe, checkRecoveryCompleted);
        });
      });
    });
  });
});
```

树里没有 HTTP、轮询、断言或文件操作的实现。
hook 实现包含进入目标状态所需的确认；it 只做探针。
包装器原生 options 的重载形式、类型推导和 YAML 校验方式留待实施阶段确定。

## 3. 对应 YAML 示意

以下命名空间与 entries 的布局只是示意；重点是稳定键和长说明不占据树文件。
步骤中出现的变量属于本次人工场景，不是从自动化内存中隐式取得的值。

````yaml
namespace: check-host
entries:
  environment:
    title: 独立环境，Host 尚未启动
    doc: 每条路径从新的隔离环境开始，不连接用户默认 Host。
  prepare:
    doc: |
      准备独立的 Host 目录、演示 Objective、Subject 和控制文件目录。
      记录仓库、固定 commit、CLI 入口及各目录的绝对路径。
      控制文件不得混放进 Host 的私有元数据目录。
      演示 fixture 的确切准备命令在实施阶段补齐。
  dispose:
    doc: |
      无论检查成功还是失败，都先释放本场景可能阻塞的执行及清理屏障。
      仅停止本场景记录且确认属于自己的 Host/辅助进程。
      确认退出后删除本场景目录，保留失败诊断但隐藏凭据。
  ready:
    title: 经 CLI 连接，Host 可用
  connect:
    doc: |
      设置 PGUIDE_CHECK_HOST_DIRECTORY 为本场景的 Host 目录。
      使用固定 commit 的演示 Objective 执行 probe。
      等待 CLI 完成，再读取 host.json 并通过鉴权 GET /checks 确认可用。
      不能仅凭 PID 存在就认为 Host 已就绪。
  readyProbe:
    title: Host 就绪且活动任务为空
    doc: |
      查询 GET /checks，预期 HTTP 200、JSON 数组为空。
      描述文件中的地址必须为本机回环地址；不要把 token 打印到报告。
  running:
    title: 提交受控任务，任务 Running
  start:
    doc: |
      提交可取消的演示 worker，保持执行屏障未释放。
      worker 的延迟清理由另一屏障控制，不能与执行屏障合并。
      记录本次 checkId，等待 worker 的已进入执行进度，再确认 Running。
      fixture 的可执行提交命令和屏障路径在实施阶段补齐。
  runningProbe:
    title: 输入正确且只执行一次
    doc: |
      查询当前 checkId 的快照，确认 Running 和约定的输入标记。
      核对调用计数及活动列表；不要通过再提交任务来完成这个检查。
  cancelling:
    title: 请求取消，任务 Cancelling
  cancel:
    doc: |
      对本次 checkId 发送 POST /checks/{checkId}/cancel。
      等待 worker 确认进入延迟清理；保持清理屏障未释放。
  cancellingProbe:
    title: 清理完成前没有终态
    doc: |
      查询任务快照，预期仍为 Cancelling。
      清理完成标记尚不存在，不能提前报告 Cancelled 或 Completed。
  cancelled:
    title: 释放清理，任务 Cancelled
  release:
    doc: |
      只释放本次任务的清理屏障，等待任务进入终态。
      记录清理完成标记，并确认 worker 已完成约定的资源收尾。
  cleanupProbe:
    title: 任务取消且资源已释放
    doc: |
      查询任务，预期 Cancelled；检查清理完成标记。
      活动列表不含该任务，任务拥有的资源已经释放。
      “发出了终止请求”本身不是资源退出的证据。
  workerFailed:
    title: 注入 worker 退出，任务 Failed
  crash:
    doc: |
      通过演示 fixture 的受控故障入口使目标 worker 退出。
      不使用仅凭 Host PID 的终止命令，以免误杀整个服务。
      等待目标任务 Failed，并保留原 checkId。
  failureProbe:
    title: 执行故障明确可见
    doc: |
      确认任务为 Failed，而不是 Completed 或永久 Running。
      确认 Host 仍可响应查询。
  recovered:
    title: 同一 artifact 再次执行，新任务 Completed
  recover:
    doc: |
      使用相同的 artifact 目录与 revision，提交正常任务，使用新 checkId。
      等待新任务终态；不能仅换到另一份从未故障的 artifact 证明恢复。
  recoveryProbe:
    title: 新任务成功，旧任务未重放
    doc: |
      新任务为 Completed 且结果正确；原任务仍为原来的 Failed。
      通过约定的线程与调用记录确认使用了健康执行环境，没有重放旧任务。
````

缺少 doc 的状态标题可以作为分组说明；实际操作、探针和清理的人工说明不能缺失。
这个区分需在实施时明确校验，不把有标题误认为有完整操作文档。

## 4. 总览输出示意

- 独立环境，Host 尚未启动
  - 经 CLI 连接，Host 可用
    - 检查：Host 就绪且活动任务为空
    - 提交受控任务，任务 Running
      - 检查：输入正确且只执行一次
      - 请求取消，任务 Cancelling
        - 检查：清理完成前没有终态
        - 释放清理，任务 Cancelled
          - 检查：任务取消且资源已释放
      - 注入 worker 退出，任务 Failed
        - 检查：执行故障明确可见
        - 同一 artifact 再次执行，新任务 Completed
          - 检查：新任务成功，旧任务未重放

终端和 Markdown 可直接显示这棵树；HTML 将同一结构作为可折叠导航。
节点标识来自稳定键及出现路径，不依赖这些展示标题。

## 5. 选中“任务取消且资源已释放”后的手册

页面应自动组合以下内容，而不是让使用者自己打开各层说明拼接：

1. **准备独立环境**：展示 prepare，列出本次需要填写的输入及 fixture 准备方法。
2. **经 CLI 启动 Host**：展示 connect，包含鉴权就绪的准入确认。
3. **提交受控任务**：展示 start，记录 checkId，确认 Running 且屏障仍保持。
4. **请求取消**：展示 cancel，确认进入延迟清理，不释放清理屏障。
5. **释放清理**：展示 release，等待确认终态。
6. **当前探针**：展示 cleanupProbe，检查 Cancelled、清理标记及活动列表。
7. **无论成功或失败均执行的收尾**：展示 dispose。

readyProbe、runningProbe、cancellingProbe 是其他 it，不自动加入这份路径。
必要的状态确认已经由 connect、start、cancel 的准入说明明确提供。

故障恢复路径同理：prepare → connect → start → crash → recover →
recoveryProbe → dispose。成功进入 Failed 状态不是阻断后续恢复步骤的理由。

## 6. 人工命令块的展示形式

例如已经完成准备且拥有本场景地址之后，鉴权查询可以展示为：

```powershell
$address = Get-Content -Raw -LiteralPath (Join-Path $hostDirectory 'host.json') |
  ConvertFrom-Json
$headers = @{ Authorization = "Bearer $($address.token)" }
Invoke-RestMethod -Uri "$($address.endpoint)/checks" -Headers $headers
```

取消指定任务可以展示为：

```powershell
Invoke-RestMethod -Method Post `
  -Uri "$($address.endpoint)/checks/$checkId/cancel" -Headers $headers
```

这些片段对应现有 HTTP 操作，但不是可直接从零执行的完整手册：
`$hostDirectory`、`$checkId`、fixture 与 artifact 身份必须先由前置步骤取得。
最终生成页面应明确列出所需变量、准备命令、预期响应和等待条件，
不能隐藏在“请阅读 helper”里。

## 7. HTML 页面阅读示意

- 页面左侧：上面的状态树，可折叠、查找和直接定位。
- 页面右侧：
  - 当前节点标题、稳定引用和平台要求。
  - 当前节点的 Markdown 说明。
  - 可切换到完整操作路径，包含命令块、检查点与最终清理。
- 不适用分支仍可见并说明原因；例如 Windows 强制结束进程不能冒充 POSIX 优雅信号关闭。
- 没有执行测试时显示“文档视图”，不显示虚假的通过标记。
- 页面不启动服务、不提交任务；说明中的命令只能由人明确执行。

## 8. 建议验证这些定义行为

| 场景 | 预期 |
| --- | --- |
| 文档模式加载本例 | 有完整树，所有转移及探针调用次数为零，没有 fixture |
| 自动模式执行最深路径 | 每个 it 重新准备环境，父到子 setup、子到父清理 |
| runningProbe 失败 | 不自动阻断后面的取消测试；后者重新建立自己的 Running 状态 |
| start 无法建立 Running | 本次依赖它的子层操作不执行，按实际资源状态清理 |
| cancel 条目不存在 | 明确报告 YAML 引用缺失，不输出一份看似完整的手册 |
| 准入说明与单独 it 同时存在 | 路径只组合 hook 的准入说明和当前 it，不串入其他探针 |
| 注入 worker 故障 | Failed 节点可被检查，恢复节点仍能进入 |
| 修改 ready 的 title | 展示文字改变，文档关联与稳定定位保持不变 |

这里列的是之后应证明的结果，不是本轮已经通过的自动化或人工验证记录。
