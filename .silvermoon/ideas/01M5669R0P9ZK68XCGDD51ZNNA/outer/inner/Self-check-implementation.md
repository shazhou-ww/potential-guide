# 独立自查实现证据

## 实现对象与证据边界

本文件记录本轮仓库实现，不是 lifecycle event，也不修改 ideal、Deployment.md 或验收 ledger。父会话负责独立检查完整 `pnpm check`、真实 ACP 模型及设备结果；测试替身不能替代该证据。

新 Objective 位于 `objectives/pguide-self-check`，由设备已安装的 pguide probe 加载。现有 `objectives/pguide-setup` 仍为 bootstrap/旧本地/SSH 入口。两个入口的授权语义有意不同：自查本身已包含一次小任务，不需要额外 allowSanity；旧 setup 默认仍不执行 sanity。

## 实际调用路径

1. installation 读取指定 pguide 的结构化版本，独立核对身份、版本和 desiredVersion。
2. configuration 复核安装和有效配置，在指定用户/项目/explicit 上下文检查 config/probe/regulate 发现、所选 ACP stdio profile、必需环境，再 initialize/session-new；不 prompt。AHP 不在范围内。
3. sanity 复核依赖和 readiness，独占 scratch 中生成随机 expected，将 task/marker.txt 写为错误值并直接读取。
4. 单独受管 Node adapter 使用仓库现有 AcpClient API 执行一个 session/prompt。提示只要求精确修复 marker.txt，不要求分析、规划、报告，也不执行嵌套 pguide regulate/self-check。
5. adapter 继承原 profile 参数和有效 regulationPermissions，权限策略来自现有实现。默认无 grants 时不自动批准请求；原 Agent 原生工具权限仍有效。请求被拒绝后，即使文件已正确也失败。
6. 独立检查要求正常 end_turn、无权限拒绝；随后 lstat 必须为普通非符号链接文件且 nlink=1，字节数与随机内容完全一致。Agent 摘要或退出码本身不足以通过。

## 快照复用与仓库表面

`scripts/build-self-check-runtime.mjs` 使用现有 TypeScript 开发工具从共享源码提取/转译依赖闭包。生成的 runtime 仅依赖 Node 内置模块，完整 Git 子目录快照不需要 node_modules；没有新增第三方依赖或 CLI 命令。权限策略中的配置形状校验使用同仓库 parseRegulationPermissions；实际资源、路径、工具请求匹配仍使用原 createAcpPermissionPolicy。

`pnpm self-check:build` 更新产物；`pnpm self-check:check` 比较归一化换行的完整产物和 wiki。默认 `pnpm test` 先执行新鲜度检查。现有 Turbo `pguide#test` 已将 objectives 纳入 inputs，因此新 Objective 与生成产物变化不会误用旧测试缓存。Biome 仅排除生成 runtime，源码和 tests 仍受 lint/format。

部署验证现有安装后 setup 路径增加 self-check 快照，并核对两个入口分别仅有一个 legacy/direct prompt。该脚本使用本地可控 ACP fixture，不是真实付费模型验证。

## 时间、输出与清理

默认 probe 每项期限为 30 秒；本 Objective 默认检查预算 20 秒、Pilot 上限 24 秒，拒绝用超长 helper 调用冒充 terminal。sanity 剩余预算给 adapter，并在外围硬截止前留 2.5 秒供 cancelAndStop/进程清理。Agent 原始 stdout+stderr 上限 192 KiB，包括无换行和非消息输出；外围进程上限 256 KiB。超时不重试，停止受管进程树。

仅清理本次 mkdtemp 独占 task、输入文件和状态目录，保留 scratch 根目录内既有文件及用户配置。配置秘密不写进 subject/新配置，输入仅含 profile 中的环境变量名。外部诊断只使用安全 stage/reason，不输出模型摘要或服务端错误正文。隔离 cwd 不是安全沙箱；恶意全权限 Agent、操作系统强杀和断电不在自动清理保证内。

## 自动回归与独立验收

自动回归涵盖 strict manifest/wiki、仅本机输入、无额外 opt-in、旧 bootstrap/SSH、缺安装/配置、ACP readiness、唯一直接 prompt、禁止嵌套 regulate/Git、摘要空操作/错误内容/权限拒绝、不完整 stopReason、原始输出上限、超时进程与 scratch/state 清理，以及提交过的 Git 子目录快照完整 probe terminal（测试替身）。

首轮回归发现并修正 Windows probe 包装器缺少解释器 shebang；旧 nested-regulation 直接 helper 测试在本共享 Windows 环境曾超 24 秒，已将其测试专用直接调用预算设为 45 秒，不改变旧生产默认，也不把这条较长直接测试当作新 Pilot terminal 证据。最终命令和结果由实现会话报告，真实设备及完整仓库检查仍由父会话记录，本文不据自述勾选验收项。

### 本轮实际命令与结果

- `pnpm self-check:build` 与 `pnpm self-check:check`：成功生成并核对完整 Node-only runtime/wiki。
- `pnpm exec tsc -b packages\pguide-cli-core packages\pguide --pretty false`：成功构建并类型检查相关包。
- `pnpm exec tsc -p tsconfig.test.json --pretty false`：全部测试源码类型检查成功。
- `pnpm exec tsx --test --test-concurrency=1 packages\pguide-cli-core\test\acp.test.ts packages\pguide\test\setup-objective.test.ts`：修正 shebang 和旧直接 fixture 的测试预算后，41 项通过，退出码 0，包含旧 setup、本地、SSH、Git 子目录及首版新自查全部回归。
- 最终增加保留更短用户 Agent 执行期限的回归，并以省略 timeoutMs 验证真实默认预算：`pnpm exec tsx --test packages\pguide-cli-core\test\acp.test.ts` 为 13/13；`pnpm exec tsx --test --test-concurrency=1 --test-name-pattern="self-check" packages\pguide\test\setup-objective.test.ts` 为 7/7，均退出码 0。新快照完整 probe 在测试替身下到 terminal，单次提示，scratch 清空。
- `pnpm exec biome lint` 的相关源码/tests/scripts/objectives 检查成功；保留 cli-core 原有 commandMain 的 `Promise<number | void>` 非阻断警告，未作无关修复。相关格式检查通过；`node --check scripts\verify-deployment.mjs` 成功。

未在此实现子会话运行完整 `pnpm check` 或安装打包的完整 `deployment:verify`，未调用真实付费 Agent、未改机器配置、未提交或推送。父会话需独立执行这些适用验证及实际已安装 pguide 的单次完整 probe，读取其 terminal 结果后再决定 gate。
