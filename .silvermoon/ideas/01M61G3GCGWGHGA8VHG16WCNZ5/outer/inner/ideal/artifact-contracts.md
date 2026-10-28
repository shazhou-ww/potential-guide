# Checker 与 Objective 制品契约

本文记录 2026-10-28 讨论收敛的方向，不是已发布 schema 或已交付 API。
本次继续演进已完成的 Check/Objective 制品及 Check Host v2，不重开其历史验收。
正式发布和内置全量迁移仍由
[artifact-release-delivery](../../../../01M6080CXKHSN7HTA91H1VDJ1J/outer/inner/ideal/Idea.md)
承担；其实施需与本次准确契约协调，本文不代替该构想的验收。

## 两类制品

- Checker 是执行检查的能力；check 是动作，Check Task 是需求，Execution 是实际调用。
- Objective 是等级和 Checker 的声明式组合；probe 是观察动作。
- 包 @potential-guide/check-host 更名为 @potential-guide/checker-host，与 objective-host
  对称；内部依赖、导出、启动/发现入口、配置及文档随之迁移。动作 check、CheckTask
  和 CheckTaskClient 不因制品名改变而机械改名。旧协议名、schema 和历史证据保持原义；
  旧包/命令是否提供兼容入口及退出方式在实施契约明确，不通过本项擅自发布或废弃 npm 包。
- 新入口分别为 checker.yaml、objective.yaml。一个制品只有一个规范入口，不保留 YAML/JSON 双份真相。
- $schema 使用不可变的公开 schema URI；具体 URI 在实施时分配并测试，本文占位不是有效发布地址。
- 无制品内 id、version、format、defaultLanguage；来源引用在外部，准确内容由 digest 固定。
- Checker 无 protocol 或 resultSchema。一个 Checker schema 同时固定 worker 导出/调用生命周期、
  输入上下文、统一结果及错误契约；不能只固定结果形状而留下 worker ABI 未定义。
- 两类制品均声明 languages；不声明 resources 或 references 索引。

## Checker 示例

```text
checker/
├── checker.yaml
├── worker.cjs
└── references/
    ├── zh-CN/
    │   ├── checker.md
    │   └── problems/
    │       └── invalid-layout.md
    └── en/
        ├── checker.md
        └── problems/
            └── invalid-layout.md
```

```yaml
$schema: "<待分配的 Checker schema URI>"
worker: worker.cjs
subjectSchema:
  type: object
  additionalProperties: false
  required: [root]
  properties:
    root:
      type: string
      minLength: 1
problems:
  - invalid-layout
languages: [zh-CN, en]
```

problems 是可报告的局部业务问题词汇，不是执行故障列表。统一结果沿用现有
CheckResult 的 ok/problems 和运行时依赖需求语义，不接受每个作者定义任意输出 schema。
ok:true 无问题和未解决需求；未知业务问题、无效参数形状或协议 envelope 明确失败。
依赖问题/requirements 为协议类型，不列进本地 problems。异常、超时、取消不包装成
业务不达标。worker envelope 到 HTTP Task result 的映射必须统一，实施时明确一次，
不可有的消费者拿 envelope、有的消费者拿 payload。

## Objective 示例

```text
objective/
├── objective.yaml
└── references/
    └── zh-CN/
        ├── system/
        │   ├── overview.md
        │   └── 404.md
        ├── levels/
        │   ├── structured.md
        │   └── verified.md
        └── checks/
            └── layout/
                └── problems/
                    └── invalid-layout.md
```

```yaml
$schema: "<待分配的 Objective schema URI>"
subjectSchema:
  type: object
  additionalProperties: false
  required: [root]
  properties:
    root:
      type: string
      minLength: 1
languages: [zh-CN]
levels:
  - id: structured
    checks: [layout]
  - id: verified
    checks: [tests]
checkers:
  layout:
    url: https://example.com/checkers/layout.tgz
    digest: "sha256:<64 hex>"
    subjectMapping: '{"root": root}'
  tests:
    url: https://example.com/checkers/tests.tgz
    digest: "sha256:<64 hex>"
    subjectMapping: '$'
```

示例 URL 和摘要仅作格式说明，不是可用发布制品。局部名字 layout/tests 不是全局身份。
levels 保序且累积，initial/terminal 沿用既有内建语义。等级只列局部 Checker 名称，
不重复筛选 problems；每个 Checker 的完整通过条件均须满足。

subjectMapping 明确是从 Objective subject 到 Checker subject 的受限 JSONata。
显式 $ 表示传递全部 subject；无隐式缺省映射。禁止文件/网络/环境读取和未授权扩展，
有界求值，结果为有限 JSON 对象并通过 Checker subjectSchema。

## References 与语言

目录决定页面 ID 和语言；frontmatter 只保存 title、description 和可选 references，
不重复语言或 ID。示例问题页面：

```markdown
---
title: 修正工作区布局
description: 当前项目对目录布局的补充要求。
references:
  - pages/base-layout-invalid-layout
---

源码应放在约定的应用与共享包目录内。
```

Objective 默认继承 Checker 页面，局部覆盖整页而非拼接或字段混合；保留显式 base
页面访问原始指导以及 owning artifact/path 证据。校验无效覆盖、悬空链接、冲突、
循环和每个有效语言下的必需页面。目录索引由工具产生，不保存第二份手写索引。

languages 表示完整支持的有效文档语言。Objective 可通过本地覆盖补齐 Checker
缺失的语言；无继承内容且未补齐时不得声明支持。Host 配置有序语言偏好：
显式请求必须支持，省略时选第一种可用语言，无交集明确失败。有效语言在受理/准备
过程中固定并返回快照；配置变化不改已有任务，语言影响输出时参与共享兼容判定。
缓存制品不写入 Host 默认语言。

## 无额外资源

新 Checker 仅包含 checker.yaml、worker.cjs 和规范 Markdown；Objective 仅包含
objective.yaml 和规范 Markdown。其他文件、链接、特殊文件和歧义路径明确拒绝，
不忽略或自动打包。无 raw resource API，也不承诺 Markdown 附件能下载。
保留页面 API；继承页面的来源仍准确，不能制造不可用的资源地址。

旧 Checker 的资源须作者显式内联 bundle、迁移或走有界兼容路径，不能直接删除。
不安装消费端依赖、不运行下载内容的构建或生命周期脚本。

## 动态依赖与迁移

不恢复静态 prerequisite，也不要求作者维护依赖 Objective 清单。运行时需求带可解析的
带类型来源引用；首次解析受来源/执行授权约束，并在本次观察内固定 digest。Regulation
传入/保存准确绑定以支持连续重查和恢复；既有绑定不匹配时失败，不悄悄升级。
依赖循环、深度、总预算与绑定冲突仍有界检查。多来源同内容不能越过权限边界共享。

去掉 objectiveId 不只是删 manifest：声明、依赖结果、versions/sources、Coordinator
键、历史恢复和证据必须一起适配。旧格式不改写；新 schema、摘要规则与显式迁移分开。
YAML 只接受有限 JSON 子集，拒绝重复键、自定义 tag、别名扩张及隐式非 JSON 值，
保留体积/深度/路径限制。不把 YAML 重排、换行转换或 Unicode 修复当成无损处理。
