# 实施证据

## 候选与边界

- Idea：`01M5XTPAGFBP4EV94YJTZCNYS1`（`test-tree-manual`）。
- 理想世界：保持已接受的 `3f01c34df2dd0473a2bb4e500ca9f56e5756c3ce` 不变。
- 实施工作树：`D:\Code\potential-guide.worktrees\test-tree-manual-idea`；
  分支 `ideas/test-tree-manual`。未修改另一工作树的旧会话成果。
- 此阶段不验收、不发布 npm、不部署公共站点，也不将自动化命令回归冒充现实世界人工验收。
- 私有工具位于 `packages/test-tree`。依赖 `yaml` 使用已有 catalog 版本，
  Check Host 仅为 workspace 开发依赖；新增包已参与层级与 package-owned 自检。

## 实现索引

| 证据 | 内容 |
| --- | --- |
| `packages/test-tree/src/model.ts` | 单一 YAML、严格字段/键/ID/说明校验、相对绑定路径、稳定检查路径与平台限制 |
| `packages/test-tree/src/runner.ts` | 预先验证全部约定符号，每检查新 context，逐级进入、立即登记 after、逆序清理与错误聚合 |
| `packages/test-tree/src/cli.ts`、`src/render.ts` | 不导入执行器/绑定，终端树、Markdown 和无脚本离线 HTML |
| `packages/test-tree/test/tree.test.ts` | 数据故障、释放语义、模块隔离、真实 Node 跳过与兄弟独立运行、HTML 安全和文档一致性 |
| `packages/test-tree/test/check-host/host.states.yaml` | 唯一的真实 Host 状态树与完整 PowerShell 人工步骤 |
| `packages/test-tree/test/check-host/host.binding.ts` | 唯一约定符号绑定，不维护手写测试树 |
| `packages/test-tree/test/check-host/scenario.ts`、`worker.cjs` | 自有隔离目录、真实 HTTP/worker、部分初始化与屏障资源所有权 |
| `packages/test-tree/test/manual.test.ts` | 独立进程执行手册中的 prepare/serve/inspect/run/cancel/release/finish/fault/recover/clean 命令 |
| `docs/check-host-manual.md`、`docs/check-host-manual.html` | 从同一 YAML 派生的完整检查路径；均明确标记未运行 |

测试入口注入模块加载函数，由执行器传入 YAML 唯一绑定的绝对路径；这不是导出注册表，
也不是由 YAML 求值代码。如此将有意的动态测试导入留在测试入口，
生产源码仍满足仓库现有静态依赖观察规则，不修改或绕过该规则。

## 验证环境与命令

Windows，Node `v24.12.0`，pnpm `11.22.0`。

```powershell
pnpm --filter @potential-guide/test-tree... build
pnpm --filter @potential-guide/test-tree test
pnpm exec tsc -p tsconfig.test.json --pretty false
node --import tsx --test --test-name-pattern='real repository has' packages\objective-monorepo-standard\test\pilot.test.mjs
pnpm check
```

最终结果：

- 工具包及依赖构建通过。
- 首轮包内 **17/17** 测试通过：六个 YAML 注册的真实 Host 检查、一个独立进程手册命令回归、
  十个数据/执行/输出/Node 适配测试。首轮整仓并行执行时同样为 17/17，通过时间约 22.5 秒。
- 全仓测试 TypeScript 检查通过；最终 Biome 精确检查 15 个相关文件通过。
- 真实 package-owned 仓库集成 **2/2** 通过（包括 regulation handoff 子用例）。
- **`pnpm check` 退出码 0**：层级检查、格式、lint、typecheck、测试及打包消费全链通过；
  Turbo 测试任务 **50/50** 成功，所有隔离 packed-consumption 组合通过。没有发布 npm。
- `git diff --check` 通过；Silvermoon worktree 检查通过，staged 检查在提交时再次执行。
- 检查完成后 `.cache/tree-host` 无遗留场景目录；手册进程确认 Host/worker 停止后清理。

本轮未观察到既有测试失败或需要以重跑掩盖的 flaky 结果。保留仓库已有的非致命诊断：
esbuild 对既有 CJS 构建中的 `import.meta` 发出警告；根 lint 的 `biome lint scripts config`
报告不存在的 `config` 路径，但该既有命令返回 0，整仓检查继续并成功。
本次没有新增虚假目录或放宽校验来隐藏这些诊断。

## 观察到的语义

- 六个真实路径为 `ready.idle`、`running.input`、`cancelling.waiting`、
  `cancelled.released`、`faulted.failure`、`recovered.result`。
  每个检查独立建立 fixture/Host；祖先探针不被当作后代准入。
- 注入执行异常后，转移成功进入预期故障状态 `Failed`；这不是业务结果不通过。
  后续同一 Host 真实执行得到 `Completed`、原输入标记与 `calls=2`，不是只检查端口；
  恢复探针同时验证原 `fault` 仍为 `Failed`，原始 `Error: manual injected failure`
  未被改写，证明旧任务未重放。增加负向回归，拒绝旧任务被写成 Completed 或错误被替换。
- 取消路径等待 `Cancelling` 与 cleaning 标记；屏障保持时没有 cleaned 标记，
  释放后才得到 `Cancelled`、cleaned 及空活动列表。
- 部分初始化抛错由转移/helper 自行清理；执行器释放已登记祖先。
  探针与多个 after 同时失败保留原始错误及逆序清理错误，其他独立测试继续运行。
- HTML 全文转义，保留 Markdown 命令为可选择文本；原生 details/锚点提供离线导航，
  没有脚本、远程依赖或自动命令执行。抛错绑定不会被文档 CLI 导入。
- 自动化和手册命令均不输出 bearer token；只删除 prepare 创建的自有目录。
  Host 清理未确认时保留目录并明确失败，禁止按进程名终止。

## 验证过程中的修正

- 首次完整检查发现新包未分类；补齐 `package-layers.yaml`。
- package-owned 集成发现缺少 `objectives.yaml`，并暴露生产动态导入不可静态观察；
  增加私有 tool 契约并将模块加载函数显式放在测试入口。同步更新真实包数断言 24→25。
- 一次完整测试因上述自检失败而中断时，Turbo 终止了正在执行的手册子进程；
  仅在确认所记录 PID 已退出后，通过手册 clean 命令删除本次自有场景目录。
- 上述均为本次接入问题，已修正后再验证；不列为既有问题或静默降级。

## 复审修订验证

- 恢复探针新增对原 `fault` 快照的严格检查：仍为 `Failed`，且原始错误字符串仍为
  `Error: manual injected failure`。负向用例分别模拟旧任务被写成 Completed、原始错误被替换，
  即使新任务结果和调用次数正确也必须失败。
- 修正执行异常与业务结果不通过的术语；YAML 手册同步写明原任务历史不变的观察结果，
  并重新生成 Markdown/HTML，派生产物一致性验证通过。已接受的理想世界未修改。
- 复审修订后包内 **18/18** 通过；最终相关 Host 用例 **7/7**、全仓测试类型检查、
  Biome 检查和 `git diff --check` 通过。
- 重新运行 **`pnpm check`，退出码 0**，包括全部测试与隔离打包消费；
  没有新增 flaky 失败，也未执行任何 gate acceptance 或 npm 发布。
