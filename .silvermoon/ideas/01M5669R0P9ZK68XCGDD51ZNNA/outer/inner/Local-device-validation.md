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

## 尚待验证

独立本机自查已由子会话完成，主会话独立执行首轮 pnpm check 成功：共 288 项测试，287 项通过、1 项已有平台跳过、无失败；pack 检查成功。

随后整合并发 primary 的版本及测试修订，解决 setup 测试冲突时保留双方新增覆盖，并重新生成自查 runtime。集成后已构建成功，安装入口返回 `0.4.0-rc.0`；待对这个集成版本重新执行完整检查与真实本机自查。首轮通过不替代集成后验证。
