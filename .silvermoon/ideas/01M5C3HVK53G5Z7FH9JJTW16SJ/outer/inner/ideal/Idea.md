# 声明和发现目录上下文中的项目 Objectives

## 问题

项目缺少可供 Agent 发现的目标入口，现有 Pilot 来源别名不能表达目录上下文、调用输入及治理对象绑定。将这些描述局限于 monorepo 或 package 会阻碍其他技术栈复用。

## 结果

任何技术栈的 Git 仓库均可在根目录或任意子目录通过 objectives.yaml 声明目标；用户级目标也独立存储，由 pguide objectives 统一发现和管理，选择后复用 probe、regulate 与依赖交接闭环。

## 边界

- 目录仅是发现上下文，不预设 package 身份、继承或 Objective 嵌套；subject 的定义域由目标 schema 决定。
- 引用 Pilot 目录并跟随来源，通过 JSONata 将上下文与显式类型的输入投影为 subject；清单不声明治理 target，也不强制锁定 revision。
- 复用 Pilot 与依赖交接闭环，补齐目录内容版本和 Behavior 更新边界；发现不授权，不另建工作流或静态依赖树。

## 验收标准

- 根目录、普通子目录与不同 checkout 能独立发现目标，不依赖 pnpm 或包清单。
- 用户级和目录级目标统一查询并保留来源；输入类型与存储作用域正交，Unit 输入可无参调用，subject 投影及校验错误明确。
- Objective ID 统一为 Pilot 目录，目录内容决定定义版本；协议、依赖、缓存和恢复无新旧身份混用，持续监督能响应来源更新并隔离旧结果。

## 支持文档

- [声明格式、CLI 发现与依赖边界](./Context-objectives.md)
- [目录身份迁移影响与验证矩阵](./Identity-impact.md)
