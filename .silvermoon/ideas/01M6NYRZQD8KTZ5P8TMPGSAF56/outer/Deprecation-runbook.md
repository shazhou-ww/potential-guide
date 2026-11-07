# 旧架构 npm 包废弃执行手册

这是交给获授权设备的计划，不是执行完成记录。2026-11-05 当时设备
`npm whoami --registry=https://mirrors.tencent.com/npm/` 返回 `ENEEDAUTH`，
未执行任何 npm deprecate、unpublish、publish 或 dist-tag 操作。不得保存登录
token、OTP 或私人 npm 配置到仓库或证据文件。

2026-11-07 已按当前源码刷新迁移边界，但没有重新验证 npm 登录、远端版本或执行废弃。
实际操作前必须重新查询，不把历史页面、旧 registry 地址或本次文档更新当作授权。

## 清单和依据

| 包 | 第一批处理 | 依据与迁移限制 |
| --- | --- | --- |
| `@potential-guide/objective-guide` | 确认已发布且管理权限满足后，全部版本 deprecate | [Guide 迁移](../../../../docs/functional-migration.md)说明已退出 workspace。定义／观测使用 Pilot 相关 API；执行使用 Task Bundles，不存在自动状态转换。 |
| `@potential-guide/objective-portfolio-supervisor` | 确认权限后，全部版本 deprecate | [Supervisor 退役](../../../../docs/supervisor-retirement.md)明确不再提供旧 Portfolio 调度。不能把 Coordinator 或 Task Engine 称为直接兼容替代。 |
| `@potential-guide/config` | **先验证新包，再执行** | [配置改名](../../../../docs/package-layering.md#configuration-package-rename)改为 `@potential-guide/pguide-config`。两者具有相同 binary，需卸载旧包后迁移，不应同时安装。 |

这三包均不在当前 workspace manifest 中。2026-11-05 npmx 只读页面可见
Guide 的 `0.1.0`／`0.2.0-rc.2`、Supervisor 的 `0.1.0`／`0.3.0-rc.0`，
旧 config 的 `0.0.0`／`0.2.0-rc.0`；这是候选证据，不是完整版本清单。
执行时必须重新读取全部版本和已有 deprecation 信息，不假设观察仍有效。

- [Guide](https://npmx.dev/package/@potential-guide/objective-guide)
- [Supervisor](https://npmx.dev/package/@potential-guide/objective-portfolio-supervisor)
- [旧 config](https://npmx.dev/package/@potential-guide/config)
- [新 config](https://npmx.dev/package/@potential-guide/pguide-config)

新 config 页面在本次观察时未找到，因此不能声称它的发布／迁移前置已满足。

## 不在本次范围

- Task Engine、Protocol、SDK、Bundle CLI、Engine CLI、HTTP／Storage／Server／WebUI
  是新架构，不废弃。
- `check-artifacts`、`check-runtime-files` 仍有活跃消费者；旧 check-task/probe-task
  适配包已从 workspace 及交付链路退役，不能再以它们证明当前依赖或重装它们。
- Pilot／Regulator／Coordinator、其协议和共享 CLI 仍有活消费者；不因“旧架构”
  一词就整包废弃。`pguide-pilot`、`pguide-check`、`pguide-probe` 已退出 workspace；
  历史 CLI 示例不是当前安装建议，也不因此将这些包加入第一批 npm 管理清单。
- Checker／Objective Host、`pguide-supervise`、已仓库移除的 `artifact-files`：
  本次未取得可靠已发布证据，不添加到批量命令。npmx 404 不等于权威不存在。
- 不做 unpublish，不删除历史产物，不重新发布，不改变 `latest` 或 `rc`。

## 另一台设备的前置

先通过 Silvermoon 正常进入本 idea 的部署阶段；计划同步不代表任何生命周期
验收已经记录。以下命令使用 PowerShell，在有组织批准的 npm 写权限和网络的设备执行。

```powershell
git pull --ff-only
silvermoon whats-next legacy-npm-deprecation --audience agent
$registry = (npm config get registry).Trim()
if ($LASTEXITCODE -ne 0) { throw '读取 registry 配置失败。' }
npm whoami --registry="$registry"
if ($LASTEXITCODE -ne 0) { throw '请在此设备的批准 registry 完成登录／授权，再继续。' }
```

不要照抄另一台机器的 registry，更不要遇到镜像只读或不支持 deprecate 时
静默改指官方地址。确认设备策略和管理端点；需要换执行环境时停止并由用户决定。
登录、包管理权限及可能的 2FA 挑战由 owner 处理，不把凭据粘贴进聊天或文档。

## 执行前基线

为每包使用只读 metadata 查询，保留时间、包名和全部版本，再逐版本记录
`deprecated` 与 `dist.integrity`，以及整个包的 dist-tag。管理查询必须在该设备
获准的 registry 执行；通常包调研仍使用 npmx。

```powershell
$packages = @(
  '@potential-guide/objective-guide',
  '@potential-guide/objective-portfolio-supervisor',
  '@potential-guide/config'
)
foreach ($package in $packages) {
  npm view "$package" versions dist-tags --json --registry="$registry"
  if ($LASTEXITCODE -ne 0) { throw "无法读取 $package 的版本基线。" }
  $versionsJson = npm view "$package" versions --json --registry="$registry"
  if ($LASTEXITCODE -ne 0) { throw "无法枚举 $package。" }
  foreach ($version in @($versionsJson | ConvertFrom-Json)) {
    npm view "$package@$version" version deprecated dist.integrity --json --registry="$registry"
    if ($LASTEXITCODE -ne 0) { throw "无法读取 $package@$version 的基线。" }
  }
}
```

如发现已存在的废弃提示，不盲目覆盖；先审核现有文案是否更准确，已达到目标则记录
并跳过写入。任何权限、包身份或版本读取失败都不是“包不存在／操作成功”。

## 第一组：Guide 与 Supervisor

以下为拟用文案；不保证迁移目标能替代旧 API 或恢复旧状态。owner 在执行前复核。
每条命令成功后先核验其版本提示，再继续下一包；不要并行批量管理写入。

```powershell
npm deprecate '@potential-guide/objective-guide@*' 'Retired Objective Guide architecture. Migrate definitions and observation to the supported Pilot APIs and execution to Task Bundles. No automatic API or state migration. See https://github.com/shazhou-ww/potential-guide/blob/main/docs/functional-migration.md' --registry="$registry"
if ($LASTEXITCODE -ne 0) { throw 'Guide deprecation 失败；保留回执，不继续。' }
```

核验 Guide 后：

```powershell
npm deprecate '@potential-guide/objective-portfolio-supervisor@*' 'Retired Portfolio Supervisor architecture. This package is no longer maintained. Migrate scheduling and policy explicitly; Coordinator and Task Engine are not drop-in API or state replacements. See https://github.com/shazhou-ww/potential-guide/blob/main/docs/supervisor-retirement.md' --registry="$registry"
if ($LASTEXITCODE -ne 0) { throw 'Supervisor deprecation 失败；保留回执，不继续。' }
```

## 第二组：config 的单独门线

不要把 placeholder 的“可下载安装”冒充功能版本验证。先选取**实际已发布**的新名称
功能版本，读取其 bin／版本／依赖，使用独立临时目录或干净消费环境安装确切版本，
确认 `pguide-config --help`／所需配置功能工作。不要覆盖现有全局配置，也不运行
会修改用户配置的写操作。缺版本、placeholder、安装失败、同名旧包冲突均阻塞这一组。

新包未满足条件时，Guide／Supervisor 可以先完成，但 config 保持待办，
整个部署验收不得完成。用户可以另行明确调整部署范围。

前置证据齐备后：

```powershell
npm deprecate '@potential-guide/config@*' 'Renamed to @potential-guide/pguide-config. Uninstall @potential-guide/config before installing a verified functional version of @potential-guide/pguide-config; both expose pguide-config. See https://github.com/shazhou-ww/potential-guide/blob/main/docs/package-layering.md#configuration-package-rename' --registry="$registry"
if ($LASTEXITCODE -ne 0) { throw '旧 config deprecation 失败；保留回执。' }
```

## 执行后核验与异常处理

重复基线查询并逐版本对比：

1. 已执行包的每个版本都有对应文案；包含历史 RC，不只看当前 latest。
2. 版本集合、dist-tags、每版本 integrity 与执行前一致。
3. 记录操作时间、非敏感执行结果及前后 metadata；部分完成与 config 阻塞分别写明。
4. 镜像 metadata 可能滞后；先等待并只读重查，不因此反复写入或声称全部版本成功。

Deprecation 是元数据提示，不是删除；旧版本仍可安装。如需撤销误操作，由 owner
另行确认后逐版本恢复基线中的原 `deprecated` 文案，不能一律清空已有提示。
本计划没有预授权回滚、unpublish 或其他包的管理操作。
