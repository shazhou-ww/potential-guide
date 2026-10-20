# CLI 拆包实施证据

本文支持 [Implementation.md](./Implementation.md)，不改变已接受的理想世界，不记录生命周期决定，也不代替部署验收。

## 包和命令归属

| 归属 | 实际包 |
| --- | --- |
| 协议层 | `@potential-guide/effects`、`@potential-guide/pilot-protocol` |
| 业务逻辑层 | `@potential-guide/objective-pilot`、`@potential-guide/objective-regulator`、`@potential-guide/objective-portfolio-supervisor` |
| 工具层 | `pguide`、`@potential-guide/cli-core`、`@potential-guide/config`、`@potential-guide/cli-runtime`、`@potential-guide/objective-declarations`、四个下述命令包 |
| 明确待外迁，不是第四层 | `@potential-guide/git-source`、`@potential-guide/objective-devbox-health`、`@potential-guide/objective-monorepo-standard`、`@potential-guide/objective-pguide-setup`、`@potential-guide/objective-pguide-self-check` |

| 命令包 | 命令与独立二进制 |
| --- | --- |
| `@potential-guide/pguide-pilot` | probe、scaffold、validate；`pguide-probe`、`pguide-scaffold`、`pguide-validate` |
| `@potential-guide/pguide-regulate` | regulate、continue；`pguide-regulate`、`pguide-continue` |
| `@potential-guide/pguide-supervise` | supervise；`pguide-supervise` |
| `@potential-guide/pguide-objectives` | objectives；`pguide-objectives` |
| 已有 `@potential-guide/config` | config；`pguide-config` |

Pilot 的编写、静态验证和观察共用来源及定义约定；调节与继续共用持久化状态、Agent 会话和工作进程，所以分别共包。监督和声明管理独立按需安装。本轮不改已有 config 包名或已有二进制名称。

命令包装包及目录统一采用 `pguide-<命令或命令组>` 前缀：`pguide-pilot`、`pguide-regulate`、`pguide-supervise`、`pguide-objectives`；相应发布 tag 也使用这些名称。共享服务仍以职责命名。已发布的 `@potential-guide/config` 明确保留为兼容性例外，不静默更换 npm 包名或 `config-v*` tag。

主包只发布 `pguide` 二进制，生产依赖仅为 `@potential-guide/cli-core` 与 `cross-spawn`。测试所需的命令和业务能力在 devDependencies 中，不进入消费者安装闭包。声明服务只依赖 CLI Core 和 Pilot 协议，声明管理不再安装观察或调节；来源服务不依赖调节，错误透传由调节调用者注入。监督通过调节工具的公开 API 复用 Agent/工作进程能力；不存在工具包循环或业务包反向依赖工具实现。

## 协议抽取

`pilot-protocol` 保存唯一的契约类型、schema 编译、严格 YAML/manifest/References 解析、结构与语义校验、受预算限制的 subject 投影、资源 URI 规则和资源能力接口。`loadPilotSpec` 只通过注入资源组装并校验定义，不包含 Git 获取、运行 checks、观察或 Agent 调用。

原 `objective-pilot` 定义 API 保留重导出以兼容旧消费者，原位置不保留第二份实现。观察、probe 和执行证据留在业务包；文件系统资源适配未放入协议包。`effects` 保持原协议生命周期原语。独立协议 tarball 消费者的内部包闭包只有协议包本身，未安装业务或 CLI。

## 自动边界

`config/package-layers.json` 明确列出所有工作区包；`scripts/check-layers.mjs` 接入 `pnpm check` 首步，检查生产源码及所有包依赖字段，包括类型导入、import type 表达式、重导出、动态导入、CommonJS、npm/TypeScript 路径 alias 和跨包相对/file 路径。未知或重复归属报错，向上引用和三层反向消费具体 Objective 报错；向下、工具直接使用协议及同层引用允许。

正反例不仅检查内存中的层级关系，还构造实际工作区验证清单、跨包类型源码与 `.d.ts` 重导出不能绕过检查。待外迁清单不自动扩充、不默认视为协议。公共打包检查同时拒绝找不到对应源码的过期 JavaScript 产物，迁移说明要求已有 checkout 先清理再构建。

## 安装与兼容证明

`scripts/check-package-consumers.mjs` 在仓库 `.cache` 下创建并清理八种独立 pnpm 工作区，只消费当前 tarball，以离线模式、禁止安装脚本运行。递归校验每个真实父依赖下解析出的内部包版本，不依赖仓库源码链接。命令环境仅暴露消费者真实生成的二进制 shim、Node 和 POSIX shim 必需的最小 shell 工具，隔离本机已全局安装的旧扩展。

| 消费组合 | 显式选择包数 | 内部包闭包数 |
| --- | --- | --- |
| 仅 Pilot 协议 | 1 | 1 |
| 仅主入口 | 1 | 2 |
| 仅 Pilot 工具 | 1 | 8 |
| 仅调节工具 | 1 | 9 |
| 仅监督工具 | 1 | 11 |
| 仅声明工具 | 1 | 4 |
| 仅 config | 1 | 2 |
| 主入口、四个命令包和 config | 6 | 15 |

组合安装使用真实 shim 验证 metadata、帮助、发现和八个子命令的主入口分发；独立命令包无需安装主入口。缺失官方命令给出应安装包及 PATH/commandDirectories 提示；同优先级冲突拒绝选择；协议不兼容通过 JSON 错误与退出码 2 返回，不再遗漏异步分发错误。

默认 tarball 模式的 `pnpm deployment:verify` 直接复用同一个八组合检查器，随后执行 npm 安装后的运行场景；既有 CI 的 Windows/Ubuntu/macOS Packed CLI 作业因此也执行全部组合。这里仅记录本机实施验证，远端精确提交的 CI 证据和部署验收由现实世界契约单独要求，未视为已完成。

原 CLI 集成测试迁移到新产物路径，继续覆盖选项、stdin、字面参数透传、JSON/Markdown、权限、持久化继续、Git 固定版本、证据和监督。每个新命令从自己的清单读取版本，metadata/help 不加载业务实现。发布清单、包级 tag 触发器、源码工作区引用、依赖锁、Docker 消费准备和分发验证器都按显式选装命令更新；本轮未发布 npm 包。

## 实际执行结果

- 本机为 Windows，Node.js `v24.12.0`，pnpm `11.22.0`。
- `pnpm exec turbo run build --force`：19 个构建任务成功；清理迁移中间产物后执行 `pnpm exec turbo run build typecheck --force`，38 个任务成功，刷新旧缓存，避免已移走的源码残留在 tarball。
- 统一 `pguide-` 命名后，定向 metadata/缺失/冲突/两种入口回归 5 项通过；包级发布命名、config 兼容性、CI 八组合接线及分发辅助回归 8 项通过。`pnpm layers:check` 通过。
- 统一命名后重新执行 `pnpm check`：通过分层、格式、lint、typecheck、测试和打包全部阶段。CLI 集成测试 84 项，82 通过、2 项按平台条件跳过、0 失败；根脚本测试 37 项全部通过，独立协议测试 2 项通过。
- `pnpm pack:check`（包含在完整检查中）：15 个发布包及上表八种离线隔离消费组合通过。主包 11 个打包文件，协议包 27 个打包文件；生产依赖闭包与上表一致。
- 统一命名后重新执行 `pnpm deployment:verify`：八种离线隔离组合和 Windows `win32/x64` 本地 npm tarball 消费验证全部通过，包含全部公开导出与命令协议、ACP 调节与继续、持久化及保留期、秘密脱敏及报告、已安装监督生命周期、已提交 setup 子目录加载和 nonce 修复、自检单次 Agent 修复、拒绝/继续授权/撤销边界。这是使用本地夹具的实施验证，不是外部目标部署或真实模型验收。验证器的持久化断言同步为既有 schemaVersion 3，未改变业务状态格式。
- `silvermoon check --worktree --audience agent` 和 `git diff --check`：通过。只完成实施清单，未追加生命周期事件；部署清单仍全部未勾选。

为遵守仓库内 scratch 限制，验证时将 Windows `TEMP`/`TMP` 指向仓库 `.cache`。较深的 `.cache/test-scratch` 曾触发现有嵌套 setup 测试的 Windows 路径长度限制；使用短 `.cache` 路径的定向 setup 修复验收通过，不更改业务超时或跳过失败。现有 POSIX 专属测试和文件符号链接权限测试按平台条件跳过；远端 Ubuntu/macOS/Windows CI、真实模型和 npm 发布未在本机伪称已执行。
