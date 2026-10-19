# Pilot package 架构与迁移范围

本文是 [Idea](./Idea.md) 的范围与架构约束，不是已经完成的迁移，也不提前确定具体实现算法。

## 迁移范围

当前正式 Objectives 均在本次范围内：

| 当前主体 | 职责 | 迁移要求 |
| --- | --- | --- |
| `objectives/pnpm-monorepo` 与 `packages/monorepo-objective` | 按项目需求检查 monorepo 结构与交付配置准备 | 合为一个完整 Pilot package，保留两个业务层次，内部按检查职责模块化 |
| `objectives/pguide-setup` | 本地或 SSH 目标的安装、配置与 sanity 检查 | 保留 bootstrap、目标机边界、显式同意与远程能力 |
| `objectives/pguide-self-check` | 已安装 pguide 的本机自查 | 保留独立自查、运行预算、直接 Agent sanity 及权限/清理约束 |
| `objectives/development-machine-health` | 开发设备健康检查 | 保留现有本机/容器目标、分层检查和环境约束 |

`objectives/pguide-setup/sanity-fixture` 是 setup 的内嵌测试 Pilot，不应仅因拥有 manifest 就另建正式 package；随所属 Pilot 一并迁移并验证其运行时可达性，不能误删为无用测试文件。

实施启动时复核当时仓库清单，纳入准备期间新增的正式 Objectives，并同步范围说明。测试专用 fixture 不自动升级为正式交付物。基础包 `objective-pilot` 等不是具体 Objective，保留其通用职责。

## 一份 Pilot，一个完整 package

- 可复用 Pilot 放在 `packages/` 下，每个正式 Pilot 独立成为 pnpm workspace package。package 名称在实施映射中确定，不通过目录重命名擅改业务身份。
- manifest、References、检查适配入口、需求 schema（如适用）、业务实现、测试及必要运行资源归同一 package 管理。构建资源与代码必须来自一致源码版本。
- package 是构建、依赖声明和交付边界，不等于必须公开发布 npm。私有 workspace 可以满足组织要求，但仍须证明声明的消费方式完整可用。
- 不在旧 Objectives 目录和新 package 中并行维护两份主体。若保留过渡入口，它只能是有明确期限/策略的薄兼容层，不能复制规则或资源。

## 内部职责

- `pilot.yaml` 负责声明业务层次与检查关系；层次不是代码模块数量，不要求一个层次只对应一个巨型 check。
- 协议入口只验证调用输入、调用相应检查并转换标准结果，不承载全部规则；其路径遵循真实 loader 协议，不为目录美观另造协议。
- 业务代码按独立检查能力拆分，单个 check 不得执行整套检查后过滤自己的 findings。保留各 Pilot 原有的前置条件和失败依赖；细化 check/problem ID 时明确兼容与迁移。
- 文件观察、解析事实、报告生成及顺序编排与业务规则分开；解析失败保留明确诊断，不以默认值或整体成功掩盖缺失。简单 Pilot 不强制创建无实际职责的空模块。
- 通用协议、进程与资源加载能力优先使用已有基础包；具体 Pilot 不作为其他 Pilot 的基础设施，不为每条断言建立 package，也不引入无需求的插件框架或跨进程缓存。

建议职责布局如下；仅按实际需要建立模块，不要求每个 Pilot 有完全相同的文件树：

```text
packages/<pilot-package>/
  package.json
  README.md
  pilot.yaml
  checks/          # 现有协议所需的薄适配入口（如适用）
  src/             # 规则、事实观察、报告与必要编排（如需编译）
  references/      # 与 manifest 同版本的解释资源
  test/            # 单元与集成测试，fixtures 按需建立
  dist/            # 需要构建时的产物，不是另一套手写源码
```

不默认建立 `examples/`。最小使用说明放 README；纯测试样本放 `test/fixtures/`；真实被检查项目的需求描述由该项目维护。现有 monorepo 仓库需求示例不能随目录删除而丢失，应归到本仓库实际需求配置或适当测试位置，并更新引用。

## 构建、消费与信任边界

- scripts 与仓库 Turbo 任务、Biome、TypeScript 和 Node/tsx 测试模式一致；共享第三方版本使用 catalog，内部依赖使用适当 workspace range。
- 必要的运行资源必须进入声明的交付内容；开发源码、生成物与依赖要有明确来源和新鲜度验证。尤其要处理现有 self-check 的生成运行时及其跨目录来源，不能简单搬目录或手工复制生成代码。
- 不假定 Git 子目录快照自动安装依赖或运行构建，也不假定 loader 已支持 npm package Pilot。各 Pilot 明确其支持的加载方式、构建时机和运行前提，并通过真实消费验证；不要求为了 package 化新增通用 npm resolver。
- 当前 monorepo Pilot 的 `checkerModule` 桥接必须有明确迁移结果：正常调用不应依赖调用者手工拼接另一个 checker 的绝对开发路径。使用版本一致、来源可信的 package 交付解决接线，具体方式由实施验证，不把目标仓库提供的代码视为可信 checker。
- 当前 setup/self-check 在 Git 快照中无需安装目标依赖的能力，以及 SSH helper 的可传输边界，不因引入 package 而悄悄退化；若架构迫使改变公开运行前提，先明确修订方案并获得决定。

## 行为与交付验收边界

迁移不增加新检查业务、不把 monorepo 配置准备扩大为实际发布/线上认证，也不借此修复无关历史故障。保留只观测与受限 scratch 写入的区别、显式授权、秘密引用、目标身份、运行预算和进程清理等原有约束。

README、CLI 来源路径、构建与验证脚本、测试、生成规则及仓库需求配置都是迁移接线范围。旧 Git 子目录 URI 会受到物理路径迁移影响，必须给出可执行的新路径和清晰兼容策略，不能只修内部 import 就认定完成。

本次创建只记录并提交准备方案；不执行产品迁移、发布、真实 Agent sanity、远程设备整备或部署。后续是否开始实施由明确指示决定。
