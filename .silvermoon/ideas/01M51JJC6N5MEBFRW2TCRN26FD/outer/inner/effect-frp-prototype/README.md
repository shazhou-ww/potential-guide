# Effect FRP 隔离验证

本实验验证[函数式模型](../ideal/Functional-model.md)需要的少量运行语义，不是生产迁移，也不代表完整 FRP 引擎已经选型或实现。

## 范围与复跑

- 固定依赖：Effect **4.0.2**，通过本目录的 pnpm catalog 与独立 lockfile 安装。
- 实测环境：Windows、Node **24.11.1**、pnpm **11.22.0**。未验证其他操作系统或最低支持的 Node 版本。
- 本目录是 private 独立 workspace，不加入根 Turborepo，不改变生产依赖或发布流程。
- [prototype.mjs](./prototype.mjs) 是运行薄适配；[prototype.test.mjs](./prototype.test.mjs) 使用 Node 原生测试运行器。

在仓库根目录执行：

```powershell
$prototype = '.silvermoon\ideas\01M51JJC6N5MEBFRW2TCRN26FD\outer\inner\effect-frp-prototype'
pnpm --dir $prototype install --ignore-scripts --frozen-lockfile
pnpm --dir $prototype test
```

Silvermoon 的 idea layout 检查不允许 world 内存在符号链接，pnpm 默认安装生成的 node_modules 链接也在此约束内。复跑后、执行 Silvermoon 观察或校验前，应将这个实验专属的生成依赖目录移到 idea 外的缓存位置，不移动源码或 lockfile。本次已将生成依赖移出 idea；下次复跑需按上面的命令重新安装。

根 Biome 配置忽略整个 `.silvermoon`。单独检查实验文件时复用根工具与规则，通过虚拟文件路径输入，不修改根排除配置：

```powershell
@'
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.join(".silvermoon", "ideas", "01M51JJC6N5MEBFRW2TCRN26FD",
  "outer", "inner", "effect-frp-prototype");
const biome = path.resolve("node_modules", "@biomejs", "biome", "bin", "biome");
for (const name of ["prototype.mjs", "prototype.test.mjs", "package.json"]) {
  const input = fs.readFileSync(path.join(root, name), "utf8");
  const result = spawnSync(process.execPath,
    [biome, "check", "--write", "--stdin-file-path=" + name],
    { input, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (input !== result.stdout) throw new Error(name + " needs formatting or fixes");
  console.log("Biome passed: " + name);
}
'@ | node
```

当前 Biome 的 stdin `check` 模式即使输出未变，也会在没有 `--write` 时报告未修复。这里的 `--write` 只作用于内存中的 stdin，再逐字比较输出；脚本不写任何文件。

## 测试证据

以下 10 项通过自动化断言验证，而非仅观察控制台日志。异步顺序使用显式 gate，不依靠任意等待时长；HTTP 测试只访问进程自己启动的本地随机端口。

| 场景 | 断言与结果 |
| --- | --- |
| 惰性与运行包装 | 构造 Effect 不执行；运行句柄可取消、等待，取消返回 interruption，不成为正常业务 Outcome。 |
| 替换顺序 | 旧任务收到 Abort 后新任务才启动，但新任务不等旧 finalizer 完成。 |
| 父取消与预取消 | 一个父 Signal 到达 Pilot 和 Agent；父 Signal 已取消时不执行同步用户计算。 |
| 完整快照一致性 | 单个 SubscriptionRef 的初始值与 100 次更新，共 101 个快照的派生版本全部一致。 |
| 独立 ref 对照 | 两个独立 ref 从 `[0,0]` 分别更新时，zipLatest 确实出现 `[1,0]`；这是揭示能力边界的通过项。 |
| 依赖级替换 | 初始 Pilot / repair 启动次数为 `[1,1]`；更新绑定、目标、单次限制后分别为 `[1,2]`、`[1,3]`、`[1,4]`；相同内容不重启；更新 Pilot 版本为 `[2,5]`，再更新 subject 为 `[3,6]`。 |
| 不合作 callback | 旧 callback 的外部操作仍可完成，但迟到结果不能覆盖新观测。 |
| 调用故障 | Effect 失败明确发布 failed 与 Cause，不伪造成功或空观测。 |
| 不可中断计算 | 即使旧 Effect 使用 uninterruptible 并最终成功，其 generation 已过期，不能覆盖新结果。 |
| 真实 HTTP 取消 | tryPromise 的 Signal 取消本端 fetch；服务端仍能继续其任务，不宣称取消等于远端停止。 |

## 关键发现

### 可以复用运行时，而不是重写一套

Effect、Fiber、SubscriptionRef、Stream 已覆盖惰性计算、结果 / 中断区分、状态订阅与资源终结等基础能力。原型只补充：

- `startEffect`：面向 AbortSignal 的运行句柄，将“发出取消”与“等待退出”分开。
- `createLatestSlot`：按 key 替换、先取消旧任务、以 generation 防止旧结果写回。
- `watchSnapshot` 与输入投影：订阅同一个已提交快照，并按领域依赖选择替换范围。

Effect 4 的 API 与 v3 文档不同。本实验使用 `SubscriptionRef.changes(ref)`，通过 `Fiber.await` 获取 Exit；没有使用低层 unsafe 中断接口。`Fiber.interrupt` 会等待结束，不能直接把它当成非阻塞的取消投递。

### 已取消 Signal 需要启动前检查

第一次运行有 **8 项通过、1 项失败**：Effect 4.0.2 的 `runFork` 可能先执行同步 Effect，再挂接已经取消的 Signal。适配层现在先检查 `signal.aborted`，已取消时运行 `Effect.interrupt`，不运行用户计算。

修复后加入不可中断旧任务的隔离测试，当前 **10 项全部通过，连续复跑 5 轮均为 10/10**。这说明原型确实发现了需要薄适配的边界，但不是对以后 Effect 版本的行为保证。

### SubscriptionRef 不自动提供跨源事务

单个完整快照能让本实验的输入投影一致；多个独立 SubscriptionRef 的 latest 组合并不提供原子提交。不能因此声称任意 Behavior 依赖图都已具备 glitch-free 事务语义。

需要一致更新的配置应先形成完整快照再发布，或者另行选择并验证事务方案。真正独立的外部源仍有各自更新时间，不应凭空假设它们存在共同事务版本。

## 尚未证明的范围

- 完整 Pilot / Regulator 业务循环、真实 Agent 与 ACP 执行。
- Git clone / fetch、ref 变化观察、版本绑定和凭据处理；领域无关的 git-source 及 Pilot 内容解释薄适配目前只是[包方案](../ideal/Package-structure.md)，原型没有实现二者。
- 真实子进程及后代进程的 SIGTERM、宽限期和硬杀清理。
- 通用 Applicative Behavior 图、所有订阅竞态、事务调度、生产级依赖身份与缓存。
- 稳定 Objective URI 的规范化；原型的 JSON.stringify key 仅用于固定测试输入。

旧计算的外部业务可以继续运行，generation 只能阻止它污染当前观测，不能回滚业务副作用。`close` 会等待任务清理，不为无限不合作的计算提供硬终止保证。

结论：**Effect 值得继续作为候选运行底座；项目层应优先是薄适配，而不是自研 Effect / Fiber / Stream。** 本实验不勾选生产实现验收项，也不意味着 idea 已验收。
