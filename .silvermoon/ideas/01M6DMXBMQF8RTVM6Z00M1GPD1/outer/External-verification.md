# 独立消费与外部验证

依据已同步的 [Deployment](Deployment.md) 执行。验证计划提交为
`a1ec6e43163ef1081085b8da879a871c25187bce`，接受的实现为
`b101e88a5a2d45c874dc037a684a90864a4d1f63`。
所有命令由主 Agent 执行或独立复核；生命周期验收由用户明确委托主 Agent，不冒称用户手工完成测试。

## D-S01 / D-AC01：独立消费

| 证据 | 执行与结果 | 边界 |
| --- | --- | --- |
| 生产 tarball | `pnpm pack:check`，退出 0，18 类隔离消费者通过；包含真实服务/CLI、Check/Probe、认证、结果、历史、SSE 重连和持久库重开 | 独立目录仅安装生产包，不用源码路径代替 npm 消费；未发布 npm |
| 生产输入不变性 | `git diff --exit-code 1cdf67c4 a1ec6e43 -- packages scripts/check-packages.mjs scripts/check-package-consumers.mjs scripts/check-mvp-consumer.mjs examples/task-server`，退出 0 | 最终修订只调整私有 UI fixture 与证据；不变生产包沿用上述最终 pack 结果 |
| 真实浏览器 | Chrome `156.0.8078.76` 隔离 profile，完整 `browser-smoke.ts`，退出 0 | 私有 UI workspace + 独立 HTTP Backend；MemoryStore，不冒称 SQLite 重启 |

浏览器命令：在仓库根执行
`pnpm --filter @potential-guide/task-engine-web-ui exec tsx fixture\browser-smoke.ts`
并传入 Chrome 绝对路径、新建证据目录及保留端口列表。
最终证据目录为 `.cache\engine-outer-accepted-target-517dc943-332a-46b4-a532-5909bae55840`，
包含 `checks.json` 与截图；证据目录不属于发布制品或运行依赖。
UI bundle SHA-256 为 `499a6bfbe0899b997dbf4f9e5aafd77cb8672873ae6147b68744534be897bcba`。

浏览器实际证明：

- Task 终态仍被观察、首次取消可用、重复取消不新增事实，终结/取消后时间继续推算。
- 已取消 Task 的 stage 随共享 Run 推进；另一需求不被误取消。
- 关闭详情不取消 Task，显式暂停才停止观察；Run 详情保持独立。
- 完整目录基线后可以更新状态；详情抽屉保留查询、成员/顺序、DOM 身份、草稿、滚动及宽度。
- 宽/窄布局、键盘行导航、焦点恢复与 CSP 检查通过；没有 CSP 违规。

主 Agent 先前两次真实浏览器失败没有被忽略：一次发现产品中终态取消/时间展示旧语义，
修复后重新提交和接受 Inner；另一次发现 fixture 错误要求实时列表全文不变，
改为验证真实结构不变量及主动源更新，再重新提交和接受 Inner。
最终浏览器在同步计划后完整复跑通过，不用旧失败或代理单次结果代替。

## D-S02 / D-AC02：重启与源事件观察

以下均在最终同步计划后由主 Agent 复跑，退出 0：

| 命令（workspace 内 `exec tsx --test`） | 用例数 | 证明 |
| --- | --- | --- |
| task-engine-storage：`--test-concurrency=1 test\storage.test.ts test\facts-v4.test.ts test\startup.test.ts` | 30/30 | 真实进程在开始、资格见证、退出事实提交前后崩溃；原域身份、单调下界、幂等与匹配恢复；不重演未知 Run；拒绝旧格式且不改旧文件 |
| check-task：`test\restart.test.ts` | 2/2 | HTTPS/file 的真实 SQLite/Worker 重启保留原始输入、时间及结果，不重演未知副作用 |
| probe-task：`test\restart.test.ts` | 1/1 | Probe 与子 Check 重启不重新观察，结果/历史仍可读取 |
| task-engine：`--test-concurrency=1 test\domain-contract.test.ts` | 6/6 | 资格见证、时钟回拨、只终止指定 Run、独立回收证明、冻结水位与后加入成员补读 |
| task-engine-web-ui：`test\collection-v4.test.ts` | 5/5 | 同源多成员完整处理后推进水位，重投不漏成员，超限原子失败，未完整分页不混用增量，断流保留客户端完整位置 |

这些是有真实子进程/数据库的 workspace 集成与协议消费验证，不冒称全部来自生产 tarball。
纯时间经过不制造源事实；查询不写匹配。恢复 stopped 不证明旧 Worker 的物理退出或资源清理。
Windows 强制终止进程不作为优雅关闭证据。Worker 隔离不是 OS 安全沙箱。

## 资源与交付

所有测试使用本轮创建的数据库、服务、浏览器 profile 与临时收藏；fixture 在结束路径关闭自有服务、
Worker 和浏览器并清理自有 profile/临时收藏。保留截图与检查结果，不触碰用户浏览器、数据库或其他会话资源。
没有执行自动数据迁移、数据清理产品、npm 发布或 Task Bundle 后续 Idea 的实施。
