# Supervisor 退役实现与验证

本文是 [Implementation](./Implementation.md) 的主体世界证据，覆盖已接受修订
`7e4b5a00972012af36787c0819aa9df9b36762a3` 的追加退役范围。此前周期请求证据仍保留原有历史含义；本文不代表门禁提交、验收、发布或外部部署完成。

## 已实现边界

- 删除 `objective-portfolio-supervisor` 与 `pguide-supervise` 的全部受控包文件、旧 Planner 及产品入口，不留下空兼容包或替代 Agent。
- Coordinator 内部拥有 `canonical-json.ts`、legacy Regulation 校验及资源能力匹配；`types.ts` 拥有 legacy `AgentResource` / runner handle 结构，Behavior runner handle 保持原有出口。排序直接复用 Objective Pilot 的 `levelRank`。
- 保留原 `canonicalJson` 的递归 `localeCompare` 排序和有限 JSON 拒绝规则，未修改 legacy 持久化键或新 Request 的既有代码点散列算法。新增固定字节、散列及非法输入回归测试。对外错误仍为 `TypeError` 及原有消息，不把旧 `ObjectivePortfolioError` 构造器引入新公共 API。
- 保留 `regulationCoordinator` 五命令 API、请求式 `coordinator`、Pilot、Regulator、AHP/ACP 权限与进程执行。单次、周期、耗尽、后继、恢复、停止和依赖续接仍由原有测试覆盖。
- 清理活跃 manifests、lockfile、TS 引用、层级、Objective 声明、发布包清单及 tag workflow。发布清单从 24 项变为 22 项；workspace 保留 23 个包（包含不发布的 test-tree）。
- 删除内置 supervise 元数据、安装提示、补全和 settings 描述；当前安装及迁移文档改为 Coordinator API 或单次 regulate/continue。保留通用第三方命令发现，不全局封禁第三方使用相同命令名；宿主上独立安装的旧扩展仍须卸载。
- 原监督 CLI 测试由真实退役断言替换，AHP process-worker 与 monorepo 依赖交接/修复/重观测测试继续覆盖剩余能力。历史 Silvermoon 文件及 events.jsonl 未改写。

## 已验证结果

在 Windows、Node `v24.12.0`、pnpm `11.22.0` 下执行：

- 直接相关组合：`node --import tsx --test` 覆盖 Coordinator 全部测试、CLI 退役/执行输出/AHP、settings/help、monorepo Pilot 和发布清单测试，**165/165 通过**。
- `pnpm layers:check`、`pnpm format:check`、`pnpm lint`、`pnpm typecheck` 均退出 0；包含 23 包构建、生产导入边界及测试类型检查。
- `node --test scripts\*.test.mjs`：**35/35 通过**；没有执行实际 npm 发布。
- Pilot protocol 单独测试 **14/14 通过**；setup 单独测试 **36/36 通过**。
- `pnpm exec turbo run test --filter="!@potential-guide/check-host" --concurrency=2`：
  **45/45 个任务成功**。其中 pguide 为 106 个测试、104 通过、2 个现有平台跳过、0 失败；没有删除保留能力的测试来绕过问题。
- `node scripts\check-packages.mjs`：22 项实际打包、10 组独立 tarball 安装消费者通过，包括 Coordinator 的类型入口和真实运行入口。独立消费者使用自身 `pnpm-workspace.yaml`（`packages: []`）和 tarball 覆盖，不从源 workspace 导入运行实现；测试目录位于仓库 `.cache`，不冒充现实世界部署。
- Coordinator 独立安装闭包为 6 个内部包，安装后的 lockfile 与闭包均不含两个退役包。新增 `scripts/coordinator-consumer.mjs` 在安装后的公共入口上验证到期派发、周期唯一后继、耗尽重读、外部追加、文件持久化、离线后重启恢复及取消后再次重启不续跑。

## 仓库总检查的未决问题

`pnpm check` 已实际执行，但在未修改的 Check Host 测试
`packages/check-host/test/discovery.test.ts` 的
`real startup and published Host crashes recover once without replaying old tasks`
失败：`Shared Check Host readiness timed out; inspect the private startup descriptor.`

使用 `pnpm exec turbo run test --filter=@potential-guide/check-host --concurrency=1`
单独执行仍复现；临时短盘符别名未改变 Turbo 最终使用的原 worktree 路径，也未解决。
从仓库根执行同一测试
`node --import tsx --test --test-name-pattern="real startup and published Host crashes" packages\check-host\test\discovery.test.ts`
则通过全部六轮崩溃恢复。现有证据只证明 Windows 下调用 cwd 相关，不将路径长度猜测当成已定位根因。
从仓库根执行完整 `node --import tsx --test packages\check-host\test\*.test.ts`
亦为 **33 个测试、31 通过、2 个现有平台跳过、0 失败**。
临时盘符已撤销，没有为获得绿灯修改或跳过该测试。

`silvermoon check --worktree --audience agent` 的候选布局为
`candidateSnapshotValid: true`，但整体退出 1：本地追踪 primary
`8f143a5764a2add4e742f6c683dfc9ff53896e96` 包含另一 Idea
`01M5XTPAGFBP4EV94YJTZCNYS1` 的事件历史，当前候选相对该基线报
`not-append-only (append)`。本次没有编辑该 Idea 或任何 events.jsonl，
也未按此观察擅自同步或修订历史；交由父代理保留并整合并发历史。

因此 I-S03 的实现工作已完成，但 I-AC03 中要求的 `pnpm check` 整体绿灯尚未证明，保持未勾选；所有 D-* 保持未勾选。父代理需审查该现有验证问题后决定后续处理，不能将当前候选标记为已经完成实现验收。
