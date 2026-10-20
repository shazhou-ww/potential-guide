# Implementation

用户已明确启动实施。范围与约束仍以已接受的 [架构规范](./ideal/architecture.md) 为准；
长期维护规范见 [Pilot packages](../../../../../docs/pilot-packages.md)。
各阶段审批由父会话独立决定，本实施会话只提交准确候选，不自行接受或豁免。

## Steps

### I-S01: 核定迁移映射与运行契约

核定全部正式 Objectives、内嵌 fixture、生成资源及调用方，确定 package 映射、可信运行时供应方式和历史入口迁移策略，形成仓库长期架构文档。

保留 monorepo-objective 包身份并合并其 Pilot；setup、self-check、health 分别归
pguide-setup-pilot、pguide-self-check-pilot、development-machine-health-pilot。
旧路径仅在历史 commit 可用，新版本统一迁移 URI 并固定完整 commit。

### I-S02: 迁移完整 Pilot 与模块职责

按统一规范合并每个 Pilot 的定义、References、实现和测试，拆分聚合脚本的独立职责，接线 workspace、构建及资源交付；复用已有基础能力，不复制实现。

setup/self-check 的共用检查与 ACP/权限来源以生成器维护；health 的 Docker 传输生成
单文件运行时；monorepo 的可信检查与第三方依赖生成 standalone 资源，以满足现有 Git
loader 不安装依赖、不执行构建的契约。各生成器有新鲜度检查，不手改生成物。

### I-S03: 更新调用方并完成回归

更新 CLI/脚本/测试/文档及生成检查，补齐迁移回归，明确记录既有失败与新增问题的区别，不扩大业务范围。

## Acceptance criteria

### I-AC01: 范围与归属完整

迁移映射覆盖四个已知正式 Objectives、内嵌 sanity fixture 及实施前发现的其他正式入口；通过清单和引用审查证明无遗漏、无重复维护主体。

### I-AC02: 架构规范实际落地

每个 package 有明确依赖、资源和构建契约；通过模块测试及构建/打包检查证明 check 可独立执行，不以重复全量检查后过滤结果冒充拆分，也不依赖隐含仓库外代码路径。

### I-AC03: 行为回归可追溯

运行 pnpm check 及针对迁移的回归，验证检查语义、报告、授权、超时、清理和资源引用；非通过项需有具体证据与处理决定，不能将既有失败或未运行项写成通过。
