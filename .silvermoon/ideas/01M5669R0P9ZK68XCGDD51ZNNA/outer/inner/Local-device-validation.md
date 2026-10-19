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
