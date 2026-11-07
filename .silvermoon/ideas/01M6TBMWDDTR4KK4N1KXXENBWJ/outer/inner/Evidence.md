# 多 Gateway 实现证据

## 决策与边界

- 可信配置为 `ipfsGatewayUrls`，最多 16 项，按规范化根 URL 排除重复；
  各配置层只保存一种来源表达。CLI 的列表使用 JSON，避免逗号分割 URL 的歧义。
- 旧单项字段及字符串工厂调用保留。新单来源预算默认 5000 ms 也用于旧别名；
  显式设为 30000 ms 可保留旧的最长单源等待。总预算默认 30000 ms，按缺失块计算。
- 沿用官方 Helia HTTP 工厂、静态 router、trustless broker 和逐块 CID 校验。
  空路由/P2P 组件及拒绝重定向保持不变；路径前缀以前就不能被实际客户端消费，
  本次在所有服务配置入口提前拒绝，并修正文档，不静默丢弃路径。
- 每块完整有序计划涵盖主机来源及显式策略授权的 hint；两者不各自重启总预算。
  无策略时不构建 hint 网络读取计划，根 CID 仍是内容/缓存身份。
- `GatewayReadError` 暴露实际尝试来源、失败类别及总预算耗尽事实。
  Bundle 准入错误保留受控诊断，不把官方库的原始响应正文带入公开错误。
- `docs/task-consumer.md` 区分设备、操作者与交付方；Linux/macOS 主命令及
  PowerShell 差异共用 `examples/task-server/verify-consumer.mjs`。
  service tarball 隔离消费者改用 npm 安装，避免把 pnpm 当作消费前提。

## 验证环境与恢复

Windows，Node.js v24.12.0，npm 11.6.2，pnpm 11.22.0。
没有执行远程机器操作、上传、发布、pin/import，也没有改动其他工作树。

首次定向测试触发 pnpm 缺失依赖自动恢复，失败于共享 store 的
`database disk image is malformed`。随后用本工作树自有 `.cache/pnpm-store`
执行 `pnpm install --frozen-lockfile --store-dir .cache\pnpm-store` 成功；
未改依赖清单或 lockfile，未删除或修复共享 store。后续命令仅在当前子进程设置
`npm_config_store_dir` 指向该目录。

首次 CLI 定向测试因 PATH 中已有全局 `pguide-task-engine` 与测试自有命令重名失败；
后续验证仅在测试子进程 PATH 中移除 `%LOCALAPPDATA%\pnpm`，未修改用户/全机 PATH
或全局安装。首次 `pnpm check` 提示 built-in settings 陈旧，已按仓库规则运行
`node scripts/build-settings.mjs`，生成文件随来源 settings 一并纳入变更。

## 验证记录

- 定向配置、CLI、service、旧资源读取及新多来源回归：13/13 通过。
  命令为 `pnpm exec tsx --test` 后列出
  `packages/task-engine/test/{multi-gateway,gateway-resources}.test.ts` 与
  `apps/pguide-task-engine/test/{config,cli,service}.test.ts`。
- 最终改动后的完整相关包：
  `pnpm --filter @potential-guide/task-engine --filter @potential-guide/pguide-task-engine test`
  通过；Engine 205/205，service 5/5，另有 1 个需要显式授权 Kubo 写入的 opt-in 测试跳过。
  未为取得成功而启用该集成测试或写入任何节点。
- `pnpm run pack:check` 通过，所有包结构通过；它只验证结构，不冒充隔离消费者证据。
- `node scripts/check-packages.mjs --task-service` 通过。消费者以 npm 安装本地 tarball，
  6 个显式入口、16 个内部包闭包；两种命令入口乘 user/file/CLI/禁用 user 共 8 组
  均先遇到 503 的首选来源，再由可信备用来源执行同一根 CID，完成大资源校验与业务结果，
  共用文档中的纯 Node 脚本核对实际 Request/Task/Run 与根 CID 身份；
  同时验证 Engine/UI HTTP 资源和自有进程退出清理。
- 最终 `sources:check`、`layers:check`、`format:check`、相关代码 lint 和
  `git diff --check` 通过。`pnpm check` 中全仓 lint/typecheck 也通过。
- `silvermoon check --worktree --audience agent` 通过；
  Ideal、Deployment 契约及事件文件保持不变，D 项未勾选，未提交、push 或记录生命周期事件。

本地 tarball 的实际组合不是同版本：`pguide@0.4.0-rc.0`、
`pguide-task-engine@0.1.0-rc.3`、`task-engine-server@0.1.0-rc.2`，
Engine/Protocol/SDK/Bundle/Web UI 为各自的 `0.1.0-rc.1`。
这只是本地候选组合，不是 npm 发布或外部部署事实。

### 全仓检查的明确阻塞

`pnpm check` 未整体通过：Windows 在既有
`packages/pguide-task-bundle/test/car-files.test.ts` 与 `test/init.test.ts`
创建文件 symbolic link 的测试中报 `EPERM: operation not permitted, symlink`，
随后 Turborepo 停止测试链。未修改这些无关测试、跳过其安全断言或更改全机权限。
因此 I-AC03 保持未完成；不能把相关包及 pack 成功扩大成全仓检查成功。

为恢复验证，尝试在本工作树自有 `.cache` 源码副本中使用本机 WSL Ubuntu
（Node v24.14.1、npm 11.11.0、pnpm 11.22.0）。WSL 到 npm registry 报
`ECONNREFUSED`；取消代理后的独立连通测试也超时。经 Windows 网络准备 Linux 原生依赖后，
离线恢复仍因缺少 `@helia/block-brokers` 的 registry 元数据报
`ERR_PNPM_NO_OFFLINE_META`，无法完成既有供应链策略校验。
未关闭该策略，未将失败的 Linux 安装或未开始的 Linux 检查标为通过。
所有仍运行的自有恢复 installer 均按确切 PID 停止；恢复条件是有文件 symlink 权限的
Windows 测试进程，或 registry/合规元数据可用的隔离 Linux 环境。
自有 Linux 源码副本已清理；本工作树 `.cache/multi-gateway-*.log` 保留原始本地检查输出供复核。

### 最后一次显式 store 恢复

父 Agent 独立重跑全部 13 个定向测试通过；primary 因无关 Idea 推进至
`79071cd099d4` 后，父 Agent 以 fast-forward 集成，并确认最新 Silvermoon worktree 检查通过。
此前恢复命令的环境变量未使 WSL 采用预期 store，不能将它们当作正确 store 的验证。

随后从当前完整候选创建全新的自有
`.cache/multi-gateway-explicit-store-check` 副本，使用 WSL Ubuntu
Node v24.14.1、npm 11.11.0、pnpm 11.22.0，仅执行一次：

```sh
pnpm install --offline --frozen-lockfile --store-dir /mnt/d/Code/potential-guide.worktrees/silvermoon-task-engine-gateway-followup/.cache/pnpm-store
```

没有设置 `--force`、`--ignore-scripts` 或关闭供应链策略。
日志明确确认实际 store 为上述路径下的 `v11`，587 个包全部复用、下载 0 个；
因此本次已排除 store 选错的问题，但独立的 registry 元数据缓存仍缺失：
`ERR_PNPM_NO_OFFLINE_META` 指向
`/home/lyweiwei/.cache/pnpm/v11/metadata-full/registry.npmjs.org/@helia/block-brokers.jsonl`，
供应链校验失败，命令退出 1。后续 `pnpm --store-dir <同一绝对路径> check`
因 `&&` 短路未执行，未宣称 native bin 恢复或 Linux 全仓检查通过。
遇到该失败后没有重试或 registry 轮询；installer 自然退出，自有副本已清理。
原始输出保留在 `.cache/multi-gateway-explicit-store-check.log`；
I-AC03 继续未勾选，其他实现与配置未改动。

## 外部证据边界

本文件仅证明确定性本地 HTTP Gateway 与隔离安装包的实现行为。
没有声称任何 Pinboard 实例、已发布 npm 版本、外部备用来源或 Linux/macOS 实机已通过。
真实入口、完整 native Task Bundle DAG、无本地 Kubo 的部署消费和恢复证据仍由
`outer/Deployment.md` 及原有 D 项控制；未根据 Pinboard pin 记录推断 Gateway 兼容性。
父 Agent 的只读 Pinboard 元数据观测及公开资料查找也未取得可用的 raw-block HTTP origin，
完整 native Task Bundle DAG 仍未验证；已有 pin 或 publication 不构成兼容证明。
