# Probe 输出与 Reference Override

本文服务于 [Idea](Idea.md)，与 [成品格式](Objective-format.md)、
[作者 YAML](Objective-build.md)共同说明业务行为。结果字段是候选，不是已实现的协议。

## Probe 是 Objective 对应的业务动作

Check 独立执行产生原始事实与原始文档引用。
Probe 根据 Objective subject 和有序阶段运行 Check，装配目标阶段与失败检查项，
并在结果中直接给出已应用 Override 的文档引用。通用 Engine 不解释这些规则。

成功的 Probe 调用不一定表示目标已完成：
首个有失败 Check 的阶段是当前目标，全部阶段通过才是 `terminal`。
Check 执行错误、取消、非法输出或映射错误是调用失败，不改装成业务 Problem。

## Probe 结果候选

```json
{
  "objective": "<Objective-root-CID>",
  "documentation": {
    "zh-CN": "ipfs://<Objective-root-CID>/references/zh-CN/objective.md"
  },
  "currentLevel": {
    "id": "prepare-environment",
    "documentation": {
      "zh-CN": "ipfs://<Objective-root-CID>/references/zh-CN/levels/prepare-environment.md"
    }
  },
  "checks": [
    {
      "id": "tools",
      "documentation": {
        "zh-CN": "ipfs://<Objective-root-CID>/references/zh-CN/checks/tools/check.md"
      },
      "problems": [
        {
          "target": "node",
          "code": "missing",
          "actual": null,
          "documentation": {
            "zh-CN": "ipfs://<Check-root-CID>/resources/references/zh-CN/problems/missing.md"
          }
        }
      ]
    }
  ]
}
```

例中覆盖了 `tools` 概述，但没有覆盖 `missing` Problem，故两页来自不同根 CID。
每个文档映射包含 Objective 声明的全部语言，URI 是可独立消费的完整地址。
`checks` 只列当前阶段有业务问题的逻辑引用，不列通过项；
该阶段所有 Checks 应被聚合，而不是只返回第一个失败 Check。

全部通过时，`currentLevel.id` 为 `terminal`、文档指向 terminal 页面且 `checks: []`。
Probe 不返回 `initial` 作为实际状态，它只是首阶段别名。
失败 Check 与当前阶段属于同一阶段，因为当前阶段表示待完成目标。

原始 CheckResult 不被覆写或强制改成新的 Check 契约。
Probe 层复制业务事实并装配有效文档；原始结果、Check 子树 CID、映射输入和
执行环境等证据如何关联，可在实施中沿现有证据边界细化，
不要求 UI 再次执行覆盖规则，也不向 CheckResult 添加未经其 Schema 允许的字段。

## Override 的作用域

Override 绑定 Objective 内的逻辑 Check 引用，而不是 Check 全局身份或物理 Bundle 名。
例如 `tools` 与 `network` 共享同一 Check 根时，覆盖 `tools` 不影响 `network`，
不改变嵌入 Check 的字节、CID、problemCodes 或其他 Objective 的引用。

第一版覆盖面：

1. Objective 自身文档与各业务阶段/terminal 文档。
2. 每个逻辑 Check 引用的概述页面。
3. 每个逻辑 Check 引用中已声明 Problem code 的问题页面。

第 1 类是 Objective 自有页面，不是对 Check 的 Override。
不提供额外 level-occurrence 级覆盖优先级；需要不同语境可以使用不同逻辑引用，
但不会因此复制物理 Check。新增该能力需要明确的新需求。

## 页面与语言的选择

对每个逻辑页面、每个 Objective 支持语言分别选择：

```text
该引用、该页面、该语言的 Objective Override
                    ↓ 未声明
原 Check 的同语言页面
                    ↓ 不存在
明确错误
```

不会从概述 Override 推导 Problem Override，也不会做跨语言回退。
所有必需 Objective 页面、业务阶段页面、terminal 页面和有效 Check/Problem 页面，
须在构建时证明逐语言覆盖。可以通过完整 Override 补充 Check 不支持的语言。
此时 Check 原始输出仍按它自己的语言契约；Probe 使用构建验证过的有效映射
生成 Objective 语言集合，不假定它与 Check 的语言集合相同。

选择是声明层规则，不是读取失败后的 fallback：
声明了覆盖却缺文件、内容无效或运行时读取失败，都明确报错，
不能偷偷退回原 Check 文档或另一语言。
构建验证页面存在与覆盖，运行时 reader 负责读取错误，不修改已保存的 Probe 事实。

## 文档文件规则

Override 整页替换 `title`、`description` 与 Markdown 正文，
不做字段 merge、Markdown 拼接或隐式继承元数据。
沿当前 Check Reference 规则，frontmatter 仅包含非空 `title` 和
非空 `description`，后者至多 200 Unicode code points：

```markdown
---
title: 准备项目所需的工具
description: 检查本项目要求的开发工具是否可用。
---

请按项目约定准备工具，然后重新运行 Probe。
```

映射必须指向当前根内的精确页面文件；未知逻辑引用、未知 Problem、
重复绑定、未声明语言、缺失必需页、越界与非法 frontmatter 在构建时失败。
Override 不能新增问题类型、修改 `target`/`code`/`actual`、改变输入或使失败变成功。
Markdown 正文、任意链接、锚点和循环检查不因本 idea 自动新增解析规则；
原 Check 的已知规则不能被扩展为隐式全站爬取。

## URI、相对资源与原文

- 自有/覆盖页面使用 Objective 根 CID 和根内相对路径。
- 继承页面优先使用原 Check 根 CID 与其既有页面路径。
- 完整 URI 在已验证身份下装配，不把自己的最终 CID 嵌入成品。
- 每个节点可脱离父节点直接读取自己的文档，不需要 code/index 二次查找。
- 原 Check 文档始终保留在嵌入子树中；Override 不销毁原文或建立全局可变覆盖层。

相对链接和图片以实际选中页面的位置为基址：
Override 页面使用 Objective 自己的资源目录；
继承页面使用 Check 原始根与原始目录。
生成覆盖页路径时必须保留作者资源布局或显式改写受支持引用，
不能只移动页面并声称相对资源仍可用。候选作者配置使用显式 resources 映射保留布局，
不要求复制继承页面到 Override 目录。

需要人工查看原始文档时，可以沿嵌入 Check 的既有页面和原始结果访问；
是否在 Probe 有效节点上增加 `originalDocumentation` 不属于本轮确定字段。

## 与旧协议的区别

现有旧 Objective 模型以 Checks 判定“达成某级”，失败通常报告前一个已达成状态；
新模型报告“当前待完成目标”，失败归属即当前阶段。
历史 `initial` 独立状态、`terminal` 别名规则不能继续沿用。
旧 Reference 的语言默认回退、level-occurrence 覆盖、wiki-link 特殊规则
也不自动成为新格式要求。

本候选保留当前 Check 的完整文档 URI 能力，并将 Objective Override 的生效点
明确放在 Probe 结果装配，而不是需要消费者理解的独立 UI 展示层。
