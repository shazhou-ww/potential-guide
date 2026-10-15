# 部署验证证据

## 验证对象

- accepted implementation commit/primary `d2d2ece68dedf585e71eb160a57372b0cbf4b262` 已由刷新后的 `origin/main` 包含。
- 部署契约 revision `866cc46b0e28` 先随 `cad8639342bd69c9eef5bc146abc2c1cbc259255` 同步；验证与可移植性修复最终位于 primary `9deb5bf6869953c40a2a60dbc8e052938e15c362`。
- 未执行任何 npm publish、name claim 或真实凭据访问。

## 可重复验证

`pnpm deployment:verify` 从六个 workspace 生成 tarball，在 `.deployment-verification/consumer` 通过 npm 隔离安装后执行，再由 `finally` 删除 tarball、consumer 和其 `node_modules`。本地 Windows 11、Node `24.12.0`、pnpm `11.22.0` 结果为通过，结束后确认临时目录不存在。

产物审计记录的文件数：

| package | 文件数 | bin |
| --- | ---: | --- |
| `@potential-guide/cli-core` | 11 | — |
| `@potential-guide/objective-guide` | 51 | `pguide-probe`, `pguide-scaffold`, `pguide-validate` |
| `@potential-guide/objective-regulator` | 19 | `pguide-regulate`, `pguide-continue` |
| `@potential-guide/objective-portfolio-supervisor` | 15 | `pguide-supervise` |
| `pguide-config` | 7 | `pguide-config` |
| `pguide` | 11 | `pguide` |

审计确认发布清单不含 `src/`、`test/`、`.tsbuildinfo` 或验证临时目录；安装后的 manifest 不含 `workspace:`，所有内部依赖均可从同批已安装 tarball 解析。隔离 consumer 实际运行全部 bin，并验证 `pguide config` 扩展分派。

同一脚本验证了 cwd 不参与发现、受控 PATH 扩展、安全元数据握手、直接与顶层 `probe` 等价、全局选项位于命令前后、`--` 原样边界、stdin subject、无效输入退出码 `2`。受控 ACP fixture 另验证 blocked=`3`、stalled=`4`、timeout/cancelled=`5`；Unix CI 执行信号取消，Windows 执行 ACP cancellation/timeout 路径。

## ACP 与持久状态

packed `pguide regulate` 通过 stdio 运行仓库 fixture 的真实 ACP JSON-RPC transport。Agent 只执行 marker 写入；目标进展由 Regulator 重探针判定。验证顺序为：

1. `regulate` 到 `terminal` 并写入报告、lineage 和 transcript；
2. marker 保持时 `continue` 返回 `still-satisfied`；
3. 删除 marker 后 `continue` 恢复最近可用 ACP session，重新修复并返回 `target-reached`；
4. synthetic secret 在 stdout、stderr、报告、lineage、transcript 中均不可见，协议记录保留 `[REDACTED]`；
5. `expiresAt` 与一天 retention 一致，下一安全命令入口删除受控的过期 Regulation；
6. blocked、no-progress、timed-out 和 cancellation 均生成明确状态与退出码。

该流程暴露并修复了“仍满足 Attempt 没有 sessionId 时丢失较早 ACP lineage”的问题：恢复现在选择最近一个有 sessionId 的历史 Attempt。相应信号测试延长专用时限以消除 CI 竞态。

## 跨平台与仓库检查

- `pnpm check`：本地通过，包含 format、lint、typecheck、test、pack audit。
- `pnpm deployment:verify`：本地通过。
- GitHub Actions [CI run 38737551393](https://github.com/shazhou-ww/potential-guide/actions/runs/38737551393)：primary `9deb5bf6869953c40a2a60dbc8e052938e15c362` 上全部通过。
- CI jobs：Node.js `22.13.0`、Node.js `24.11.1`、Packed CLI `windows-latest`、`ubuntu-latest`、`macos-latest` 均为 success。

跨平台试运行同时暴露并修复了三项验证基础设施问题：Unix fixture check 缺少执行位、`pguide-config` 测试错误嵌套、clean checkout 不存在 workspace bin wrapper。修复后矩阵使用同一 packed CLI 脚本通过。

## npm 名称观察

在 `2026-10-15T12:32:24Z` 执行 `npm view pguide name version --json`，registry 返回 `E404 Not Found`。这仅表示该时点公开 registry 查询未找到该名称，不构成保留、claim 或未来可用性保证；未发布任何包。
