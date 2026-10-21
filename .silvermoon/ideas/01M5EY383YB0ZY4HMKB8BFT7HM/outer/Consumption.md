# 固定版本真实消费验收

## 契约与范围

本轮按 primary `5dac9ce58148` 上已存在且未变化的 [Deployment.md](./Deployment.md)
执行，其文件 blob 为 `ea6234f37fdf`。实施验收后重新执行下列消费，不改变已验收的
Inner World。被消费代码固定为 `e4a7428bc969`，没有从移动 main 或实时 workspace 加载。
两组独立安装的十六个包入口均已核对实际路径，全部位于仓库外各自的消费者目录。
没有 npm 发布、远程部署、生产改动或修改原工作区。

原始复核观察、来源、逐 check 身份、计数、timing 事件、真实 CLI 输出及变化反例见
[consumption.json](./consumption.json)。输入与包摘要、完整前后对照及复现程序沿用已验收的
[实施证据](./inner/Validation.md)和 [performance.json](./inner/performance.json)，
不复制或改写其结论。Node v24.12.0、pnpm 11.22.0、第三方版本、预算和插桩保持一致。

## D-S01 / D-AC01：固定消费与收益复核

重新执行仓库外安装的公开 `withPilot/observe` 入口，固定 HTTPS Git commit、21 包
subject 与同一份业务 archive。冷/热含义仍为新进程、新作用域的首次与后续运行，
不是清空操作系统缓存，也不跨 probe 复用 observation。

| 部署阶段复核 | 总耗时 | 观察耗时 | 对记录的相应基线观察下降 | check 进程 | 实际 inventory 遍历 |
| --- | --- | --- | --- | --- | --- |
| 冷 | 49.030s | 33.961s | 25.48% | 44 | 2 |
| 热 | 47.438s | 38.160s | 16.37% | 44 | 2 |

两次均 standardized、0 problems，精确来源 commit/tree 均通过独立 Git 对象校验。
计数与实施阶段完全一致：每次只捕获一份视图，内部两次遍历；22 次实际观察、
21 次复用、43 次逻辑观察。宿主与子进程合计 readdir 1016、lstat 3760，
没有遗漏 FileHandle 读取。

本次共享环境中墙钟波动较大，第二次捕获本身耗时 18.586 秒；不能只呈现实施阶段
22 秒附近的有利样本。与记录的约 45.6 秒基线观察相比，本轮仍下降，但不是每次都减半，
也不构成 30 秒 SLA。计数稳定下降与墙钟样本分开报告；来源网络准备不归因于优化。
约 8.30 MB 视图重复校验/传递产生的额外读取成本仍按实施证据明确保留。

随后从真正安装的 CLI、隔离用户配置、默认预算和 `--no-reports` 再次观察成功：
code0、standardized、0 problems；含来源准备总耗时 51.497 秒。
它证明默认整次观察预算下的一个成功消费，不是整条 CLI 的耗时上限。

## D-S02 / D-AC02：变化、独立入口与回收

在同一已安装 runtime 和来源绑定内连续重新观察：

1. 原始目标成功。
2. 删除 effects README 后立即重观察，结果为 initial，问题仍归属包 Objective：
   expected structured、current initial，而非旧成功或根伪造的内部缺陷。
3. 恢复原始字节后重观察，重新成功；每轮都创建新视图并在退出时删除。
4. 包级 Git Objective 独立消费成功，来源集合只包含包 Objective，没有借用根通过结论。

变化后重新计算全部输入路径/字节摘要，与实施证据完全一致，临时目标已恢复。
三类预算在同一固定安装版 CLI 上的 1ms 反例沿用未变化的
[原始诊断证据](./inner/performance.json)：来源准备和观察均 code2，单 check 为
504/code6，分别保留 source-preparation-timeout、observation-timeout、check-timeout
及对应阶段身份，不再只报通用 fiber 中断。

部署阶段再次在第三个真实嵌套 check 进程启动后取消：原始取消原因保留，
三个子进程全部 close；临时目录及共享视图文件全部确认 ENOENT 后 API 才返回。
原始结果保留在 consumption.json。未执行目标脚本或借用现有测试通过结果充当外部消费。

## 验收结论

两条性能主线已在固定版本独立消费者中验证，变化、修复、新根观察、独立包、
明确截止与实际进程回收均有证据。部署仅指本地固定版本真实消费，不代表 npm 发行。
本轮没有引入 worker、并发层级重排、跳检查或跨轮缓存。
