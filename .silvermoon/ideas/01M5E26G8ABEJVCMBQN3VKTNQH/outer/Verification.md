# 本机部署验证

## 对象与边界

- 已验收实现：`aa9624dd2dced414f9b91538aef3d64986e236e9`。
- 源码提交：`d105c425694ef4e3688901e1ec1e40efec403f4e`，包含实现提交 `2f788363a0691f069a8ba01b25ffd7079e8891ea`。
- 构建位置为本 session 独立 worktree。未读取或复制原工作目录的并发未提交文件；未发布 npm，未运行真实 Agent 或额外付费 sanity。
- 部署前重新观察设备，实际仍为 YAML v2，默认 Agent 为 local-sanity，probe 为 90000 毫秒；独立资源中存在四个 Objective 声明。没有沿用交接作为验证结果。

## D-S01 / D-AC01：本机全局构建

`pnpm run build` exit 0，21 个构建任务成功；构建复用已通过完整检查的相同输入缓存。实现检查已另有新鲜执行及打包消费证据，不把这次缓存构建称为新鲜测试。

保留设备既有 `%LOCALAPPDATA%\pguide\bin` 全局安装位置，备份后更新全部十个 `.cmd` 包装入口，均调用本独立 worktree 对应 package 的 dist。实际 `Get-Command` 的十个 PATH 解析结果均匹配这些入口，不再指向原工作目录。各入口 JSON help 成功，根 help 无命令冲突且所有发现命令兼容；`pguide --version` 为 0.4.0-rc.0。

| 入口 | 目标构建文件 SHA-256 |
| --- | --- |
| pguide | 2530c546f5e89402a5d6cee43bc4d992796b8ce510b8138435984f2724c6802c |
| pguide-config | 830198cbc25605898846bfed22317862a0a3b222a59f4c0a7fd44a485486de21 |
| pguide-agents | 5e2e20def63df6658aa0c13d090cd92d21188c7333d9bf6d9aca8068300e8f9f |
| pguide-objectives | f829cd57598bf8d1c46e0ac3f73aa9439eeced37558de1cdeab7abead323b963 |
| pguide-probe | 88b83c55815814b6d75c77daeeadacf70a0e13f298a4e6e2ea9fe69d46020d87 |
| pguide-scaffold | 0827925c6faf6bc1f720b4e5528f4c3983a19b0e236a9377a8b7725b7443b830 |
| pguide-validate | 9de4e6f1952924faaceaf3655faa7db1997542845c72cd5402a6fdbb03dbeab8 |
| pguide-regulate | 0c81db1a5920b46e1298995658a96f647c6726415d467f1df040e2a57af77d08 |
| pguide-continue | f7957c3ce4211d0b26ed4b30db24839ebeda3d42283739e5b9f474c365b0957d |
| pguide-supervise | 3db02bdaa3d20da7ec63928cf053761853a72af990bf32a441729f7d31ff7e59 |

## D-S02 / D-AC02：逐字段手工迁移

先备份并校验三个配置/资源文件和十个包装入口。用户级 config.jsonc 仅包含三个旧显式设置的逐字段映射：commandDirectories、defaultAgent、regulationStrategy.probe；旧 schemaVersion 不进入新配置。归档旧 config.yaml 后，普通发现只读取用户级 config.jsonc，没有项目覆盖或未验证设置。

旧配置解析结果与新全局 `config show` 的十项有效值逐项深比较，来源均存在。下表是脱敏核对结果，不是配置原文：

| 新 setting | 结果 |
| --- | --- |
| pguide.commandDirectories | 原全局包装目录不变，目录内入口已更新为本构建 |
| agents.defaultAgent | local-sanity 保留 |
| pilot.probe | timeoutMs=90000、maxRetries=0、delayMs=0 原样保留 |
| regulate.agentTimeoutMs | 旧无显式值，保留 1800000 默认 |
| supervise.agentTimeoutMs | 旧无显式值，保留 30000 默认 |
| pguide.diagnoseAhpTimeoutMs | 旧无显式值，保留 30000 默认 |
| regulate.quota | 原默认 300000/10/3 保留 |
| regulate.permissions | 原无授权，仍为空 ceiling/grants |
| pilot.reportsEnabled | 原默认 true 保留 |
| objectives.aliases | 原无旧 alias，仍为空对象 |

agents.yaml 与备份逐字节相等，gpt-5-mini、工具权限、provider 参数和凭据引用未改；没有复制其内容到主配置。根及直接 agents 入口均可读取默认 Agent，结果相等；这证明资源读取，不声称完成 Agent 认证或执行。

四个 Objective 名称与 URI 保留：monorepo-standard、pguide-setup、pguide-self-check、devbox-health。实际两个 setup/self-check 投影均为 `input`，因此只删除各自 inputSchema 的 configPath property 和 required 项；对迁移前对象仅做这四处预期删除后，与迁移后完整对象深比较相等。未修改投影、其他声明、模型、权限或通用 schema 身份，也未重建资源或运行资源迁移。

使用已验收源码的两个 manifest 和真实已迁移声明，执行 parseObjectives 与 bindObjective：无 configPath 的合成输入均绑定成功，带旧字段的输入均明确拒绝。workingDirectory 指向本 worktree，scratch 使用本地独立备份下的预期位置；只做静态投影/绑定，不执行检查或 Agent。未改旧 pinned snapshot、存档或其他未指定输入文件。

## D-S03 / D-AC03：全局验证与恢复

- `pguide config validate --format json` 与 `pguide-config validate --format json` 均 exit 0，status=valid，unverified=[]，输出一致。
- 根及直接 `config show` 的有效值、来源、实际文件和问题列表一致；实际文件仅为用户 config.jsonc，issues=[]。
- 根及直接 `agents show local-sanity`、`objectives list` 成功且结果一致；无资源重复迁移。
- `pguide diagnose --format json` exit 0，schemaVersion=1；未带 agent 参数，不启动 Agent。
- 本地综合验证脚本退出 0：全部入口路径/构建摘要、逐字段有效值、备份、Agent 字节、声明最小差异及新输入绑定断言通过。验证脚本存于本 session 的 files 目录；其运行输出仅为断言结果与上述脱敏摘要。

备份仅在设备 `%LOCALAPPDATA%\pguide\backups\package-settings-d105c425694e`，包括原 config.yaml、agents.yaml、objectives.yaml 和 bin 下十个入口；备份内容不入仓库。原 YAML 另保留为用户配置目录中的 `config.yaml.package-settings-d105c425694e.bak`，不在自动发现位置。两份原 YAML 与部署前内容相等。

恢复须将包装入口、旧主配置和旧声明作为一组恢复：先停止依赖入口的调用，保全当前新配置，将 config.jsonc 移出发现位置，再恢复备份 config.yaml、objectives.yaml 和原包装入口；agents.yaml 未改，无需覆盖。旧包装入口依赖原本机构建，恢复前必须另行确认其可用性，不把备份存在称为旧构建永久可用。本次没有执行回滚。

当前安装依赖本独立 worktree 的已验收 dist；不能在迁移到其他已验证安装前删除该 worktree 或清理其构建产物。没有 npm 发布、秘密记录或额外授权。
