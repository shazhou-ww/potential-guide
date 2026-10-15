# Deployment evidence

## Primary 同步

- 2026-10-15 刷新 `origin/main` 后，其 tip 为 `eaf13e3274dbe683f5b4872317e881a8502c2a52`。
- `git merge-base --is-ancestor eaf13e3274dbe683f5b4872317e881a8502c2a52 origin/main` 成功，确认已接受的 implementation commit 可从 refreshed primary 到达。
- 验证期间未发布任何 npm 软件包。

## 仓库验证

- `pnpm install --frozen-lockfile` 成功。
- `pnpm check` 成功：格式、lint、类型检查、12 项测试及三个 workspace 的 pack 检查全部通过。
- pack 检查确认公开入口和归档内容；三个归档均包含 `dist/index.js`、`dist/index.d.ts`、`README.md`、`LICENSE` 和 `package.json`，且不含源码、测试或 TypeScript build metadata。

## 隔离 consumer 验证

从上述 commit 构建三个 workspace 后，以 `pnpm pack` 生成并校验以下临时产物：

| 产物 | 大小 | SHA-256 |
| --- | ---: | --- |
| `potential-guide-objective-guide-0.1.0.tgz` | 28123 bytes | `4552a5d3f5f8eb1d6158e5a36a3f32efc0b7174a81a4316a5142d63c9750daee` |
| `potential-guide-objective-regulator-0.1.0.tgz` | 5730 bytes | `4be764e6394ed3d64542969c120a0c932a2960906338ca4e901733095ebe5ecd` |
| `potential-guide-objective-portfolio-supervisor-0.1.0.tgz` | 7541 bytes | `bfc639ee36261c8bfac23ca1c5d937afd090caf965972292158917114f8add5a` |

consumer 使用独立 `package.json`、lockfile 和 `node_modules`，并通过本地 `pnpm-workspace.yaml` override 将 supervisor→regulator→guide 的内部依赖固定到这三个 tarball。`pnpm install --offline` 成功；生成的 lockfile 仅以 `file:../packs/*.tgz` 解析 suite 内部依赖，没有使用 registry 中的同名版本。

consumer 随后完成：

1. 导入三个软件包声明的全部公开 runtime 入口；
2. 观察 Guide instance 的 `guided` 层级；
3. 由 Regulator 执行一次修复并重新 probe；
4. 由 Portfolio Supervisor 规划并执行该 directive；
5. 断言结果为 `target-reached`，最终层级为 `terminal`。

命令输出为 `public entries: verified` 和 `Guide -> Regulator -> Portfolio: terminal reached`。验证后已删除临时 tarball、consumer 与其 `node_modules`。
