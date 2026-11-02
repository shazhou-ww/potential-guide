# Task Bundle 独立消费与恢复验证

依据已同步的 [Deployment](Deployment.md) 执行。验证计划提交为
`54a71ef969a005213f2adf9ebf217f3777007541`，接受的实现为
`90a038df8d54259a0d17d7fecd8999a804ed6f04`，实现交付提交为
`f2604206d41c3d6aa147f187dd9aaa4247d612e4`。
前置 Idea 已在 `275ac6d84eb66b885a69c57e50d8833698ab5c61` 完成；
本轮未修改其契约、ledger 或事件。以下最终外部命令均由主 Agent 在同步计划后执行。

## D-S01 / D-AC01：生产形态与浏览器

| 命令 | 结果与实际证明 |
| --- | --- |
| `node scripts\check-packages.mjs --task-sdk` | 退出 0。真实生产 tarball 安装；独立作者构建进程退出后依赖隔离；故意依赖 SDK 的负对照隔离前成功、隔离后找不到模块；自包含 Worker 无 node_modules 仍完成真实协议与结果 |
| `node scripts\check-packages.mjs --task-bundles` | 退出 0。独立生产宿主不能解析 SDK、Check 或 Probe；作者依赖不可用时仍实际执行自包含 Check/Probe Bundle，检查负向业务结果、子任务和证据，而非空成功 |
| Chrome 隔离冒烟 | Chrome `156.0.8078.76`，完整 `browser-smoke.ts` 退出 0；Bundle 提交/Request 准备独立于 Task，后续 Task/Run 观察、取消、重做、目录与宽窄交互均通过 |

浏览器命令为仓库根执行
`pnpm --filter @potential-guide/task-engine-web-ui exec tsx fixture\browser-smoke.ts`
并传入 Chrome 绝对路径、新建输出目录及保留端口列表。
最终结果保存在 `.cache\bundle-outer-final-d5edff99-4cf3-4406-b504-7c7fd9190f6e\checks.json`
及同目录截图。UI bundle SHA-256：
`6cf61ea3920015404e06ce9a9df88c4c3b951e83338ba55a0708021c7581463e`。
`bundleAdmission`、终态首次取消/幂等取消、取消后 stage 推进、停止观察不取消、完整成员/顺序与草稿保留均为 true；
CSP 违规列表为空。UI 是私有 workspace 应用，MemoryStore 浏览器场景不冒称 SQLite 重启证据。

### 受控产物身份

追加一轮 `PGUIDE_KEEP_PACK_CONSUMERS=1` 的相同生产 Bundle 消费检查，退出 0，
记录以下合成制品身份后清理该轮临时消费者。URL 仅是本轮验证位置，不是发布地址或后续可用性承诺；
Digest 对应完整文件树，不是归档压缩字节。

| 制品 | 验证时 URL | 完整 Digest |
| --- | --- | --- |
| Check Task Bundle | `file:///D:/Code/potential-guide.worktrees/task-engine-contract-refactor/.cache/potential-guide-packs-uM1dR7/task-bundles/check-task.tar.gz` | `sha256:50ba62d21d72c86d12500695285a85ad2137c5ee2ce856be03739c2b1b387e36` |
| Probe Task Bundle | `file:///D:/Code/potential-guide.worktrees/task-engine-contract-refactor/.cache/potential-guide-packs-uM1dR7/task-bundles/probe-task.tar.gz` | `sha256:1eefe2e282602ccc6af16fb6304a0817dd7161663b34acb16256c282a6f24093` |

## D-S02 / D-AC02：跟踪、崩溃及观察

下列命令在对应 workspace 通过 `pnpm --filter ... exec tsx --test` 执行，全部退出 0。

| workspace / 用例文件 | 通过数 | 核验重点 |
| --- | --- | --- |
| task-engine-storage：`bundle-admission.test.ts format.test.ts` | 14/14 | accepted/rejected 提交前后四种真实进程崩溃，最多一 Task；v5 原域重开；v4 等旧格式及 WAL 原字节不变 |
| task-engine-http：`bundle-admission.test.ts` | 2/2 | 旧 Task 形状回执、错误 token/不完整引用明确拒绝；preparing 与 Task 分离，断开 long poll 不取消处理 |
| task-engine-server：`bundle.test.ts` | 1/1 | 真实认证 TCP 服务执行 SDK 入口；删除内容/作者模块后 SQLite 重开，历史读取不执行或复验业务 |
| check-task：`restart.test.ts` | 2/2 | HTTPS/file 重启保留原始输入、时间及结果，不重演未知 Run |
| probe-task：`restart.test.ts resource-release.test.ts` | 3/3 | Probe/子任务恢复不重做业务；子 Run 观察及独立资源释放证明保持 |
| task-engine：`bundle-admission.test.ts bundle.test.ts` | 9/9 | 持久容量拒绝与获取失败幂等；preparing 跨停机/窗口推进；逐请求结果及最终创建时间；缓存按 Digest 共享、容量再检查/淘汰重取；无准备总截止 |
| task-protocol：`qualification.test.ts` | 17/17 | 合法额外字段参与判等；纯 now 回拨保留关系，实际早退可失配；不得借用历史见证，取消/停止互斥；完整源事件与冷重放 |
| check-artifacts：`archive-limits.test.ts` | 3/3 | 流式拒绝越界/链接/特殊/重复/冲突路径及容量超限；压缩元数据不改内容身份，文件名/字节变化改变 Digest |

这些是实际进程/数据库、HTTP 及协议集成证据，不全部称为生产 tarball 消费。
主 Agent 还独立完成整仓 `pnpm check`，退出 0，包含构建、层次、格式、lint、类型、测试及全部生产消费者。
此前 Windows SDK consumer 的 EPERM 实际失败已保留在 Inner 记录；
修复为独立作者进程真实退出后再隔离依赖，没有新增 sleep 或忽略错误来伪称通过。

## 交付与限制

- v5 不自动迁移旧库；保留原始文件，显式新域才开始新格式。preparing 恢复不授权重演已开始的 Run。
- 当前验证环境为 Windows、Node `24.11.1`。Worker 是独立执行堆，不是 OS 安全沙箱。
- 公共生产入口只接受 Bundle；旧注册字段运行时明确拒绝，类型目录 HTTP 路由不存在。
  protocol 根仍有 `CoordinatorService` 等内部用途的旧接口类型声明残留；它们不是第二套可构造生产执行通道，
  不宣称所有旧类型声明已移除。生产历史只做事实及绑定 Schema 静态校验，不启动旧业务 verifier。
- 没有发布 npm、覆盖用户数据库、修改收藏产品逻辑或变更前置 Idea。各测试关闭自有服务/Worker；
  浏览器自有 profile/临时收藏已清理，端口已关闭。截图/checks 保留用于人工复核。
