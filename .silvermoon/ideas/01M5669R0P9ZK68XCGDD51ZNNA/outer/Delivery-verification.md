# 独立本机自查交付验证

本文件只记录已接受实现的外部交付结果，不把实现阶段的本地快照或 fixture 结果沿用为交付通过。

## 已冻结的交付契约

- 实现 `328ef4cd0c4740ff2001b677984060d4e23ab306` 经用户接受，acceptInner 发布于 primary commit `d037049c62740907b7485077da006cae73576845`。
- [Deployment.md](./Deployment.md) 的明确目标、来源和通过条件先以 `6debeeb466200e98c7be27b41fa01a070b7747ec` 同步到 primary，观测的 deploymentRevision 为 `c2bab228e1f4731da386b7c67a9ffd9c0176b57f`，之后才执行本次检查。最终材料只增加证据引用和清单结果，没有改变已验证的目标或标准。
- 后续证据直接来自该契约指定的 GitHub URI 和既有认证容器，不重新构建/导出认证镜像，不迁移 keyring，不替换默认预算或权限。

## 目标与来源

| 项目 | 实际值 |
| --- | --- |
| 目标容器 | `pguide-agent-keychain-1ce0ed16` |
| 容器 ID | `6e7bfd245d885f314a13eb892733754c4612c9969edc34962922064a333bf938` |
| 用户 / HOME | `node`，UID `1000` / `/work/home` |
| 已安装 pguide | `0.4.0-rc.0`，打包安装的隔离 consumer |
| 已安装 CLI 的源码 | `e4e84fd9b09d95bfd9e652dd432c1342bc7c79da` |
| 实际 Agent / model | 官方 Copilot `1.0.98` / `gpt-5-mini` |
| 交付 URI | `git+https://github.com/shazhou-ww/potential-guide.git#packages/pguide-self-check-pilot/pilot.yaml` |
| 固定交付 revision | `d037049c62740907b7485077da006cae73576845` |
| 该提交的 Pilot tree | `9c73bc977eb53ba51ceddb55a0f2d312724231dd` |
| subject / 外层 probe | `60000 ms` / `90000 ms`，重试为 `0` |
| 本次外部证据 | `/work/runs/delivery-self-check-aylsAx` |

执行前刷新 origin/main 并确认固定交付 commit 可达；目标容器在禁止交互 Git 认证、禁用 credential helper 和用户/系统 Git 配置的探测中，能够直接读取 GitHub primary。随后完整 pguide probe 使用上述远程 URI，而不是本地导入仓库或 fixture。验证器的 Git 配置隔离保持不变，没有向目标转交宿主 Git 凭据。

目标 keychain 由用户正常解锁并通过官方流程认证，当前配置未发生变化。先核对已有真实 baseline 的 ready、同一安装、同一模型、一次 prompt、独立内容核验和清理记录作为前置门线，没有再次运行 baseline 来增加模型调用。交付自查本身仍重新执行 installation、configuration 和真实 sanity，不把 baseline 当作交付 terminal。

## 实际交付结果

已安装的 pguide 对 GitHub 固定 commit 执行一次完整 probe，进程退出 `0`。原始 probe.json 记录：

- Envelope status `200`。
- current.objectiveId 为上述远程 GitHub URI。
- current.levelId 为 `terminal`。
- problems 为空。
- versions 对该 URI 精确匹配 `d037049c62740907b7485077da006cae73576845`。

安全 ACP 方法审计确认 configuration 与 sanity 的 session/new 均为所选模型，完整自查只有一个 session/prompt。修复会话在启动后 `8675 ms` 完成会话并发出 prompt，`24872 ms` 正常 end_turn，随后停止/清理；不是超时后取消冒充完成。检查程序独立读取随机 marker，只有普通非链接单硬链接文件的大小与精确内容通过才返回成功。

本次仅预授权实际随机任务目录中 marker 的绝对路径写入，保留 shell/URL 工具拒绝和额外临时目录限制，没有权限请求或被拒绝记录。受控启动器校验容器私有 runtime 目录和 socket 归属后接入已有 Secret Service，不改 Git probe 的全局环境白名单，不复制 token、认证文件或用户口令。

独占任务和状态目录已清理，scratch 中只保留预置 keep.txt，原内容不变。没有 target 或 allowSanity 输入，没有嵌套 regulation，没有自动重试、临时扩大权限或重复真实请求以确认结果。

## 主会话独立复核

主会话直接读取容器原始 probe.json、subject.json、config.json 和 audit.jsonl，独立断言目标 UID/HOME、远程 URI、精确交付 revision、terminal、空 problems、显式期限、零重试、一次 prompt 和正常 end_turn、模型匹配，以及 sentinel 与清理结果；不是只相信外层验证器的 terminal 布尔值。

原始证据保留在目标 run，安全副本为会话文件：

- `deployment-terminal-probe.json`
- `deployment-terminal-verification.json`
- `deployment-terminal-audit.jsonl`

这些副本不包含 token、口令、prompt 正文、模型文本或随机期望值。临时公开验证器已定向删除，没有为交付验证手动读取、复制或改写 HOME/keyring 和用户配置，没有操作其他容器；Agent 正常使用其自己的容器用户状态。运行中的目标环境保留供用户后续使用，不 docker commit/export。

发布前 pnpm check 退出 `0`（373 项报告、371 通过、2 项已有跳过）；实际执行根脚本 24 项和 monorepo 34 项，其余十一 workspace 测试复用缓存。原始日志在会话的 `deployment-pnpm-check.txt`。生命周期 worktree/staged 检查另行执行；仓库回归不作为真实交付证据的替身。

## 适用范围与门线

D-S01、D-AC01 由直接远程 GitHub 加载、精确交付版本和 primary 可达性证明；D-S02、D-AC02 由目标用户容器的已安装 pguide、真实文件修复和独立 terminal 核验完成。Deployment 清单的勾选是 Agent 工作记录，不是用户 acceptOuter。

结论只属于指定 Linux 容器、用户、安装、模型和显式 60/90 秒预算。没有证明默认 20/30 秒配置、Windows 宿主或其他设备已就绪，没有发布 npm。后续远程整备必须由 B 自己安装的 pguide 运行同一自查，以 B 的结果验收；本轮不宣称已完成 A 对 B 的整备接入。容器重启后需用户重新解锁 keychain，认证和模型变化后需重新建立相应就绪证据，已有报告不是永久凭证。
