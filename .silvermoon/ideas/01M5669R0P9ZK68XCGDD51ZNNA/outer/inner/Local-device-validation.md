# 当前用户设备的独立验证

本文件由主会话记录，与子会话实现验证分开。仅已实际执行的项目记为通过；安装、配置语法或命令发现通过不等于完整自查通过。

## 设备与安装来源

- 系统：Windows；Node.js v24.11.1；pnpm 11.22.0；已有 GitHub Copilot CLI 1.0.96-2。
- 操作前未发现 pguide 命令、目标用户配置或目标 shim 目录，没有覆盖既有 pguide 用户设置。
- 建立当前用户的持久源码链接入口：`C:\Users\leescott.REDMOND\AppData\Local\pguide\bin\pguide.cmd`，配套七个官方子命令入口。
- 入口指向本工作树构建产物；版本为 `0.3.0-rc.0`。这是设备级源码链接，不是已发布 npm 版本，也不证明源码 commit 一致。
- 未修改系统或用户 PATH，验证使用入口绝对路径。入口依赖本工作树及其构建产物继续存在。

## 配置与权限边界

- 新建用户配置：`C:\Users\leescott.REDMOND\AppData\Roaming\pguide\config.yaml`；使用 schemaVersion 2，commandDirectories 指向上述用户入口目录。
- 专用 ACP profile：`local-sanity`，使用已有 Copilot 可执行入口和 `gpt-5-mini`，不自动申请服务或订阅。
- 只预授权 `write(marker.txt)`，保留当前工作目录路径限制，禁用额外临时目录访问；没有使用 allow-all-tools、allow-all-paths 或 allow-all。
- 只声明 USERPROFILE 环境变量名，以便 Agent 自行使用既有本机认证；没有放宽 Git probe 的环境隔离，未读取或复制认证文件、token 或父会话 SDK 凭据。
- 此 profile 专用于最小 marker 自查，不声称能够修改一般项目文件；平台或 Agent 要求的其他权限仍应拒绝或正常确认。

## 已执行的安装检查

主会话通过上述持久入口独立执行：

| 检查 | 已观察结果 |
| --- | --- |
| pguide --version --format json | 身份为 pguide，版本 0.3.0-rc.0 |
| pguide config validate --scope user --format json | 用户配置有效 |
| pguide --help --format json | config、probe、regulate 等七个官方子命令均 compatible:true，conflicts 为空 |

## 主会话独立验证

独立本机自查已由子会话完成，主会话独立执行首轮 pnpm check 成功：共 288 项测试，287 项通过、1 项已有平台跳过、无失败；pack 检查成功。

随后整合并发 primary 的版本及测试修订，解决 setup 测试冲突时保留双方新增覆盖，并重新生成自查 runtime。集成后安装入口返回 `0.4.0-rc.0`。

主会话对集成源码候选 `2819bf7831169db74fa02d2cacbc74de3bc6a7a8` 再次执行 pnpm check，退出码 0：

- 格式、lint、类型检查和 runtime/wiki 新鲜度检查通过。
- workspace 共 277 项测试，276 项通过、1 项已有 Windows 平台跳过；根脚本另有 14 项通过，合计 291 项、无失败。
- 八个包构建与 pack 检查通过。
- 保留现有非阻断 lint warning，没有进行无关修复。

## 安装产物与 Git 快照集成验证

主会话随后独立执行 pnpm deployment:verify，退出码 0。
八个包完成打包，仅安装 pguide 入口包的隔离 consumer 能解析传递依赖并导入公共库，
CLI 契约、ACP regulation、恢复与权限回归均通过。

新旧 Objective 均从临时仓库中已提交的 Git 子目录快照加载；安装后的 pguide
对新自查达到 terminal，核对精确源版本、空问题列表，且日志仅有一次 direct Agent repair。
最终输出包含：

```text
installed pguide loads committed setup subdirectory and verifies real nonce repair
installed pguide self-check snapshot verifies exactly one direct Agent repair
deployment verification passed
```

这里使用可控 ACP 测试替身，不证明真实用户模型可用；这是实现阶段的打包集成证据，
不是已进入 deploying，也不替代 D-AC02 的真实交付自查。

## 真实本机自查与认证阻塞

主会话使用持久安装入口运行一次完整 probe，固定自查源码候选 `2819bf7831169db74fa02d2cacbc74de3bc6a7a8`：

```text
pguide probe
  --pilot git+file:///D:/Code/potential-guide.worktrees/device-setup-discussion-steps#objectives/pguide-self-check/pilot.yaml
  --revision 2819bf7831169db74fa02d2cacbc74de3bc6a7a8
  --subject-file <当前用户会话中的非秘密 subject>
  --config C:\Users\leescott.REDMOND\AppData\Roaming\pguide\config.yaml
  --format json
```

已观察到：Envelope status 为 200，准确源版本匹配，current.levelId 为 configured；
当前 sanity 返回 acp-unavailable，安全诊断 stage=session-new、reason=agent-rejected。
临时 scratch 已清空。命令退出码为零不代表自查通过，因此没有记为 terminal。

另用同一已安装 Copilot 入口及相同最小环境执行仅 initialize/session-new 的有界诊断，
没有发送 session/prompt。服务端错误码为 -32000，错误消息的安全分类明确为 authentication-required。
既有 COPILOT_HOME 与默认用户目录相同，不能通过换目录获得另一套已登录状态。
没有读取或复制任何凭据，也没有把父会话的 SDK token 传给独立 ACP 进程。

这证明本机独立 ACP 入口当前需要认证，不等于自查通过，也不等于先前另一设备的模型不支持问题。
需要设备用户通过其正常 Copilot 登录流程建立可用认证，或提供已经授权且已登录的独立 ACP 入口，才能重新验证真实修复。
主会话不能代替用户完成交互登录、提取 gh token 或申请权限；已停止模型尝试，不循环重试。
I-AC03 因缺少真实 terminal 证据仍未满足，不提交或批准实现验收，更不批准交付验收。

## 2026-10-19 后续真实入口复验

首轮结果保留为历史；本节记录源码 `811f28d802028b8c5a82337a47f9b111d83cedb6` 的新证据，不把旧 configured 状态沿用到新实现。

- 当前持久 pguide 入口自报 `0.4.0-rc.0`；实际独立 Copilot CLI 已更新到 `1.0.98`。
- 主会话复用生成的共享 AcpClient，分别使用 profile 原有 USERPROFILE，以及补充正常 Windows APPDATA/LOCALAPPDATA 的环境进行有界 readiness 诊断。两次 initialize 成功，session/new 均被拒绝，安全分类均为 `authentication-required`，prompt 次数为 0，清理均确认完成。
- 未改用户 profile，未传递 SDK/gh token，未读取认证文件，也没有通过另一账户、目录或权限扩张绕过登录。
- 安全诊断报告保留为会话持久文件 `current-acp-readiness.json` 和 `current-acp-readiness-standard-paths.json`。

主会话随后通过同一持久安装入口运行一次完整 probe，将上述命令中的 revision 固定为 `811f28d802028b8c5a82337a47f9b111d83cedb6`，使用既有 subject、用户配置和 24000 ms 预算。原始报告保存为会话持久文件 `real-local-self-check-report-811f28d.json`：

| 检查项 | 实际结果 |
| --- | --- |
| 命令退出码 / Envelope status | `0` / `200` |
| 报告 versions | 精确匹配 `811f28d802028b8c5a82337a47f9b111d83cedb6` |
| current.levelId | `installed` |
| check / problem | `configuration` / `acp-unavailable` |
| 安全诊断 | `stage=session-new`、`reason=agent-rejected` |
| terminal | 未达到 |

新版 configuration 已真实执行 session/new，因此认证错误在 installed 阶段即阻断，并未进入 sanity；不把 Envelope 200 或旧版 configured 当作成功。

已通过一次结构化询问请求设备用户完成正常 `copilot login`，但用户不可用，未获得新的认证状态。后续不在未改变外部条件时重复询问或尝试模型调用。待设备用户正常登录后，再用已安装入口执行一次完整 probe，按实际精确 revision、terminal、空 problems 和独立文件检查结果验收。

同版本 Windows 八项历史回归和 pnpm check 已恢复通过；独立干净安装容器也已通过正反例，见 [Docker 验证](./Docker-validation.md)。这两类成功均不补足本节缺少的真实认证与 terminal，I-S03、I-AC03 保持未完成。

## 正常浏览器登录恢复尝试

随后主会话检查 CLI 的顶层和 login 帮助，未发现无交互认证状态查询入口；没有因此发送模型请求。为尝试官方恢复路径，执行一次 `copilot login --web-flow`，仅在该临时子进程中移除继承的 `COPILOT_GITHUB_TOKEN`、`GH_TOKEN` 和 `GITHUB_TOKEN`，不向登录命令传入 token，不读取或复制凭据。

本次官方浏览器 OAuth 流程等待约 150 秒仍未返回完成报告。主会话已终止本次登录进程树，避免遗留等待中的 CLI 或回调服务；OAuth URL、原始认证响应及任何凭据均未打印或持久化。没有确认认证恢复，也没有据此重复 ACP 或真实 probe。

这次恢复尝试不构成登录成功或 terminal 证据。后续需设备用户完成正常登录；在未确认外部认证状态改变前，不再自动触发浏览器流程。I-S03、I-AC03 及所有交付门线仍保持未完成。

## 2026-10-19 当前 Windows 用户的有界验证

本轮运行环境已变为当前 Windows 用户 Wei，不沿用上述另一用户的安装、认证或阻塞结论。未读取认证文件，未传递父会话 SDK、gh 或其他 token，未修改用户配置、PATH 或工具权限，也未触发浏览器登录。

- 当前环境为 Node.js `v24.12.0`、pnpm `11.22.0`、Copilot CLI `1.0.98`。
- 已存在持久入口 `C:\Users\Wei\bin\pguide.cmd`，指向另一现有工作树的 `packages\pguide\dist\bin.js`；安装自报 `0.3.0-rc.0`。本轮没有将该安装替换为当前源码，也不据版本号推断其源码 commit。
- 既有用户配置校验通过。所选 `copilot` profile 使用 Node + 已安装 Copilot 的 `npm-loader.js`、ACP stdio/protocol 1，仅声明 `USERPROFILE` 环境变量；没有显式 model 或额外 regulationPermissions。本轮保持这些设置不变，不自动授予 marker 写权限。
- 使用该已安装 pguide，固定已同步源码 `c1f2a42763658f77f8a3bd84011f0213b5d9e63b`，通过 `#packages/pguide-self-check-pilot/pilot.yaml` 加载新 package 路径；subject 指定当前用户的隔离目录、上述安装及配置，预算为 `24000 ms`。

只执行了一次完整 probe；退出码为 `6`，原始报告为：

```json
{
  "status": 504,
  "payload": null,
  "message": "timeout: direct Agent exceeded its deadline."
}
```

该固定错误由 direct sanity 返回，说明本次执行已越过配置和 ACP readiness，而不是复现旧用户的 `authentication-required`。但报告没有最终 level、精确 versions 或 Agent 完成结果，不能证明 prompt 已发送、模型可用、marker 修复成功或 terminal。独立检查确认本轮 scratch 目录没有残留子项。非秘密 subject 和报告留在本会话持久文件中，不把机器本地路径当作可移植复验入口。

当前实际阻塞是既有 Agent 在允许的完整自查预算内未返回成功证据；不在外部条件未变时重复模型调用，不放宽 24 秒 Pilot 上限，也不以较长直接 helper、测试替身或旧设备结果代替 terminal。下一步需先确定可在该预算及既有权限内完成 marker 修复的已授权 ACP profile，或取得针对启动/执行耗时的独立非模型证据并修复已证实的问题，再执行一次精确 revision 的完整自查。I-S03、I-AC03 保持未完成，不记录 submitInner、acceptInner 或交付验收。

本轮另执行 `pnpm check`，退出码 `0`：格式、lint、类型检查、四个 runtime 新鲜度检查、测试及 build/pack 检查通过。workspace 报告合计 348 项测试，346 通过、2 项跳过；根脚本 16 项全部通过，总计 364 项、362 通过、2 项跳过、0 失败。effects 与 git-source 的测试为 Turbo 缓存回放，其余十个 workspace 的测试重新执行，根脚本重新执行；pack 阶段构建复用前面生成的 Turbo 缓存。不把这些自动回归记为真实 terminal。保留既有非阻断 lint 警告，没有进行无关修复。
