# 声明和发现目录上下文中的项目 Objectives

## 问题

项目缺少可供 Agent 发现的目标入口，现有 Pilot 来源别名不能表达目录上下文、固定规则版本及治理对象绑定。将这些描述局限于 monorepo 或 package 会阻碍其他技术栈复用。

## 结果

任何技术栈的 Git 仓库均可在根目录或任意子目录通过 objectives.yaml 声明目标；pguide 能发现、选择并绑定目标，复用 probe、regulate 与依赖交接闭环。

## 边界

- 目录仅是发现上下文，不预设 package 身份、继承或 Objective 嵌套；subject 的定义域由目标 schema 决定。
- 引用固定 Pilot revision，通过 JSONata 投影上下文与调用输入；清单只声明可用 Objectives，不声明治理 target，发现不授予执行权限。
- 复用现有 Pilot 和 objective-dependency-problems 目标协议，不另建工作流、静态依赖树或发布系统。

## 验收标准

- 根目录、普通子目录与不同 checkout 能独立发现目标，不依赖 pnpm 或包清单。
- CLI 从声明与直接 Pilot 入口绑定到可验证的同一实例，版本、输入、上下文及错误均明确。
- monorepo 等具体目标可观察各目录目标并形成依赖，由 Supervisor 推进；不在检查器内嵌套治理。

## 支持文档

- [声明格式、CLI 发现与依赖边界](./Context-objectives.md)
