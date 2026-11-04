# 实施验证与性能证据

## 对照边界

- 原始起点：`c7ce1b2de595626f4befadfd0f36862f42dd136c`。该版本的完整冷运行因固定 ULID 过期触发真实 admission floor 校验而失败，不能充当成功基线。
- 可比较控制：`b330d934fe9fea5073f885340e1d26b55d1d7090`。原始起点只有两处测试代码修正：`apps/pguide-task-engine/test/service.test.ts` 和 `scripts/check-task-service-consumer.mjs` 使用当前时间戳的请求 ID；另同步 Silvermoon 元数据以保持历史完整。不修改生产 admission 检查、检查编排、并发、缓存或性能路径。
- 候选：`c50c6fac463b903f224056321ef96a780cef7a65`。候选使用与控制逐字相同的两个请求 ID 修正；仅针对这两个文件的 `git diff b330d934 c50c6fac` 为空。
- 两组均使用同一 harness，Node 为 `22.13.0` / `24.11.1`，pnpm 为 `11.22.0`，环境为 GitHub Actions `ubuntu-latest` / Linux x64。每个 Node 的控制与候选共享同一 runner 实例；不同 Node job 独立，不混算其绝对耗时。单次成对测量不是统计显著性结论。
- 每个 job 先安装冻结依赖，再执行完整 `pnpm check` 冷运行；随后在同一 checkout 执行热运行。冷指构建产物、`.staging` 和 Turbo 缓存为空，不包括依赖安装/下载；热指复用上一轮所有本地缓存。没有恢复共享 Turbo cache，也没有跳过失败步骤。
- `scripts/measure-check.mjs` 使用单调时钟记录总时间、按顺序识别 stdout/stderr 的根阶段、记录精确 Git revision 和退出码；实际 pnpm 子进程回归覆盖嵌套标记和失败传播。总时间不含最后收集 Git/pnpm 版本的开销。
- HTTPS 预检仅在单独的 harness checkout 中构建并运行，不写入被测 subject 的 Turbo/build outputs；其时间不计入测量。测量 JSON 写入原有 `.cache/check-metrics` 生成边界，避免测量自身污染真实仓库分类检查。

## 最终配对方法与先导数据的限制

先导的 [控制运行 41845446291](https://github.com/shazhou-ww/potential-guide/actions/runs/41845446291) 和 [候选运行 41846278697](https://github.com/shazhou-ww/potential-guide/actions/runs/41846278697) 八轮均完整成功，但日志显示 `ubuntu-latest` 正在滚动镜像：Node 22 控制/候选分别为 Ubuntu 26.04 `20261025.179.1` / `20261101.186.1`，Node 24 顺序相反。其冷/热总秒数分别为 Node 22 控制 763.88 / 191.34、候选 559.24 / 82.35；Node 24 控制 574.00 / 161.63、候选 503.28 / 85.25。**这些独立镜像对照只用于估算成本，不计最终收益验收。**

在最终配对运行前，提交 `474dad91a88cf5a32fecd5cfc18591d7a450fa47` 固定门槛：两个 Node 的冷轮各至少改善 10%，热轮各至少改善 25%。同一提交新增 `baseline` 输入；[配对运行 41849316869](https://github.com/shazhou-ww/potential-guide/actions/runs/41849316869) 对每个 Node 使用同一 job、同一 runner 实例、同一镜像和工具，顺序运行控制冷/热、候选冷/热。控制和候选 checkout 互相独立，开始时均无自身构建/Turbo 产物；全部依赖预先安装，执行顺序和共享 OS page cache 不属于“冷 OS”实验，不能外推统计显著性或整个 CI wall-clock 的同等比例改善。

## 最终同机完整结果

八轮 `pnpm check` 的退出码全部为 **0**，达到预先固定的冷轮 10% / 热轮 25% 门槛。完整原始秒数、阶段记录、artifact 文件 SHA-256、source revision 和 job/image 信息永久保存在 [Measurements.json](./Measurements.json)，不依赖 Actions artifact 的保留期限。

每条 `artifactSha256` 是 artifact 内对应原始 `cold.json` / `warm.json` 字节的 SHA-256，不是 ZIP 或汇总文件的哈希。

| Node | 缓存 | 控制秒数 | 候选秒数 | 减少秒数 | 改善 |
| --- | --- | ---: | ---: | ---: | ---: |
| 22.13.0 | 冷 | 766.10 | 578.89 | 187.22 | 24.44% |
| 22.13.0 | 热 | 191.54 | 89.35 | 102.18 | 53.35% |
| 24.11.1 | 冷 | 384.79 | 314.55 | 70.24 | 18.26% |
| 24.11.1 | 热 | 111.69 | 48.07 | 63.62 | 56.96% |

阶段秒数如下；候选的 `sources:check` 包含前置构建，故将它与 `layers:check` 合并后再与控制比较。总耗时另含约 0.6–1.3 秒 pnpm 进程启动，不应强行令阶段之和等于总时间。

| Node / 缓存 / 版本 | 源码、构建与分层 | format | lint | typecheck | test | pack |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 22 冷 / 控制 | 59.15 | 1.08 | 13.07 | 28.39 | 538.20 | 124.97 |
| 22 冷 / 候选 | 64.09 | 1.08 | 13.10 | 29.09 | 441.53 | 28.73 |
| 22 热 / 控制 | 3.06 | 1.07 | 0.90 | 9.45 | 50.01 | 125.78 |
| 22 热 / 候选 | 6.24 | 1.09 | 0.92 | 9.33 | 42.76 | 27.74 |
| 24 冷 / 控制 | 32.24 | 0.59 | 6.66 | 14.19 | 255.59 | 74.94 |
| 24 冷 / 候选 | 30.87 | 0.56 | 6.23 | 13.46 | 249.23 | 13.60 |
| 24 热 / 控制 | 1.67 | 0.59 | 0.50 | 5.17 | 29.99 | 73.16 |
| 24 热 / 候选 | 3.32 | 0.59 | 0.52 | 5.17 | 24.28 | 13.60 |

Node 22 job 的镜像为 Ubuntu 26.04 `20261025.179.1`，Node 24 为 `20261101.186.1`；**各自四轮使用同一镜像、同一 runner**，不跨 Node 混算。两 job 在热轮之后均以 38/38 build cache hits 将移走的 Objective staging 逐文件、逐字节恢复成功。

主要收益是默认检查不再重复运行完整消费者；这些断言仍在三 OS 的交付验证中。Node 22 的测试阶段也缩短约 96.67 秒，但不能把旧 HTTPS 单测约 305 秒直接宣称为整轮节省。更严格的前置源码保护在 Node 22 冷轮增加部分成本，仍完整计入总时间。

产品、默认检查、测试和交付的可执行代码以及 Turbo 图冻结于 `c50c6fac`；后续只增加同机测量编排、阶段证据和文档。没有测量后调整运行代码或验收门槛。

## 覆盖映射

| 原职责 | 实施后的执行位置及证明 |
| --- | --- |
| tarball 文件、exports、bins、禁用依赖、LICENSE、陈旧输出和开发文件 | 默认 `pack:check --structure` 保留原完整打包循环及全部结构断言；仅不进入消费者安装分支。 |
| 20 个隔离场景及 Bundle 作者/运行时安装 | `consumers:check` 保留原默认全量分支；`deployment:verify` 及其 Linux/macOS/Windows CI 调用与起点完全一致。因此完整消费者从五轮降为三轮，未删除 macOS file fail-closed、Windows 入口/Worker 或任何其他独有断言。 |
| 跨 Node 兼容性及跨平台 npm 安装/CLI 运行 | 原 CI 的 Node 22/24 默认检查和三 OS 部署矩阵不变；所有原 npm 依赖图、发现、安全路径、前台运行及关闭断言仍保留。完整交付为 `pnpm check && pnpm deployment:verify`。 |
| 发布前消费者门禁 | publishing workflow 在默认检查后显式运行 `consumers:check`，避免默认检查分层意外减少原发布前验证。新增静态回归核对两个入口均存在；没有执行发布 workflow、增加 tag、修改权限或发布 npm。 |
| Objective 重复生成 | 测试不再无条件 `workers:build`；改由 Turbo build 提供生成或缓存恢复。六个 Objective 的 `.staging/<package>/**` 成为各自 build outputs，生成器脚本成为显式 inputs，package-standard 补齐跨包源码、定义和资源输入。 |
| 生成源码与产物一致性 | settings 先显式校验；六份已检入的 settings/Worker 源码在构建前快照保护，构建后检测漂移且无条件恢复原始字节；再运行原 task Worker 校验。schema、自检、health、monorepo、setup、Objective Worker 校验全部保留。schema 不由 build 覆写。 |
| 冷生成与根目录校验字节一致 | self-check 的 directory probe bundling 明确 `absWorkingDir: root`，修复 workspace cwd 与根 cwd 不一致的问题。`verify-worker-cache.mjs` 移走 staging，再构建并逐文件比较恢复字节；失败时恢复原资源。不得与读 staging 的测试并发执行。 |
| HTTPS 安全与离线覆盖 | 原双 digest、拒绝 redirect/oversize/tamper、超时缓存清理、离线复用断言均保留。生产 preparation 显式拥有 deadline controller/timer，并在完整操作后清理；对独立/组合 caller signal 各验证 150ms 的慢响应体超时在 5 秒内失败，缓存仍为空。仅修复原有截止时间约束，不改 TLS、digest 或文件安全边界。fixture 子进程在 API/backend 完成后刷新输出并退出，测试取消也会终止其子进程；整个测试上限 30 秒。 |
| 测试类型、并发与错误传播 | 根 `tsconfig.test.json` 检查和并发 2 不变；新增快照漂移、部分构建失败、互斥 scope、测量失败退出码回归，所有异常仍向上失败。 |

## 已执行的本地回归

本地环境为 Windows、Node `24.12.0`、pnpm `11.22.0`，只作功能诊断，不与 Linux 耗时混用：

- HTTPS 真实获取回归通过（修改后首次定向运行约 7.44 秒；不是整轮性能证据）。
- 实际 Node `22.13.0` 的 artifact acquisition 文件全部 10/10 通过；显式子进程退出后的定向 HTTPS 回归也通过。没有改变项目依赖或全局 Node 安装。
- Gateway service 回归 3/3 通过，涵盖 direct/UI 两条真实提交路径及错误 Gateway 不回退 RPC。
- 根脚本回归 48/48 通过，包括所有新增的真实 pnpm 测量、源码快照和失败传播回归；日志 `.cache/performance-tooling-latest.log`。
- staging 字节级恢复通过，六个 Objective 使用缓存恢复；日志 `.cache/performance-cache-proof-final.log`。
- 向 marker Worker 注入操作自有的漂移字节后，`workers:check` 正确返回 1；原始字节恢复后返回 0，日志 `.cache/performance-stale-worker.log` / `.cache/performance-worker-restored.log`。
- 本地完整 `pnpm check` 仍在既有文件符号链接测试处遇到系统 `EPERM`，未跳过或弱化断言；最终 deadline 实现的日志为 `.cache/performance-check-deadline-final.log`，不能记为成功性能样本。
- 本地历史 Turbo 缓存包含已退役 `objective-pilot/dist/service.js`，结构检查正确拒绝。仅删除四个已确认退役的同名构建输出并强制刷新该包及其必要依赖的 build/typecheck cache 后，`pnpm pack:check` 对全部 37 个 tarball 通过；没有广泛清理共享缓存，日志 `.cache/performance-pack-verified.log`。
- `node scripts/check-packages.mjs --task-service` 对真实安装的服务消费者通过：6 个显式入口、24 个内部包，独立/组合入口各覆盖 user/file/CLI/disabled-user 配置，日志 `.cache/performance-task-service-verified.log`。
- 本地全消费者入口在最后的 bundle-authoring 安装中遇到 registry metadata 不提供锁文件已有的 `eventemitter3@^5.0.4`；返回 1 而未掩盖。该失败不作为通过证据，也没有修改生产依赖或隔离约束来绕过，日志 `.cache/performance-consumers-final.log`。

## 完整交付回归

[CI 41846290743，attempt 2](https://github.com/shazhou-ww/potential-guide/actions/runs/41846290743/attempts/2) 绑定候选 `c50c6fac`，Node 22/24 的完整 `pnpm check` 及 Linux/macOS/Windows 的完整消费者、npm 安装和 CLI 运行均通过。首次 Windows job 在既有 MVP 等待窗口内仍为 `running` 而未到 `completed`；未更改代码、等待预算或断言，仅重新执行失败 job 后整组通过。该重试不用于性能数据，完整覆盖仍存在。部署 ledger 保持未执行，供主体世界审批后的独立外部验收使用；没有发布 npm。

## 排除的运行

- [原始失败基线 41834953886](https://github.com/shazhou-ww/potential-guide/actions/runs/41834953886)：两节点因过期测试 ID 失败；其 601.20 / 581.16 秒不计入收益。Node 22 同一 HTTPS 测试记录 305.32 秒，Node 24 约 3.01 秒，证明异常等待存在，但不等于整轮收益。
- [首次候选 41836108138](https://github.com/shazhou-ww/potential-guide/actions/runs/41836108138)：冷入口提前校验 Worker 时缺少尚未构建的 workspace exports。已用源码快照保护的构建解决，而非跳过校验。
- [中间候选 41838436030](https://github.com/shazhou-ww/potential-guide/actions/runs/41838436030)：仅服务端清理仍不足以解决 Node 22 子进程等待；Node 24 冷轮成功，但热轮被测量文件自身的未知职责分类正确拒绝。已分别修复子进程生命周期和测量输出位置，未放宽 timeout 或仓库分类契约；该不完整对照不计收益。
- [有界诊断 41844019024](https://github.com/shazhou-ww/potential-guide/actions/runs/41844019024)：Linux Node 22 在 `/slow:acquire` 阶段超出 150ms，尚未进入 backend 关闭；排除了“仅关闭连接/退出进程即可修复”的解释。测试信号将失败等待限制到 30 秒。显式拥有 deadline 的修复随后在 [41845005946](https://github.com/shazhou-ww/potential-guide/actions/runs/41845005946) 的 Node 22/24 HTTPS 预检分别约 8 秒 / 11 秒通过（含构建），此处不将预检当作完整性能样本。
- 中间候选及旧 harness 被后续精确测量替代；取消、失败和不完整运行均不计入成功对照。

## 复现入口

```sh
gh workflow run check-performance.yaml --ref agents/optimize-pnpm-checks-performance \
  -f baseline=b330d934fe9fea5073f885340e1d26b55d1d7090 \
  -f revision=c50c6fac463b903f224056321ef96a780cef7a65
```

复现时须核对 workflow 与脚本内容未改变。每个 job 的 `check-metrics-<node>` artifact 保留冷、热 JSON；应同时核对退出码与阶段，不能把失败、提前退出或安装时间当作改善。
