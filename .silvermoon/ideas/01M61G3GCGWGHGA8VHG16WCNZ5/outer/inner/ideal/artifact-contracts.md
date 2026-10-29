# Checker 与 Objective 制品契约

> 当前 Request 生命周期修订是一套全新、不兼容设计。下文涉及旧协议兼容或迁移的
> 描述仅保留作旧设计背景，不是新方案的兼容义务；制品内容契约仍按当前修订范围使用。

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
- $schema 使用不可变的公开 schema URI；本套新制品均从 v1 开始，采用独立命名空间：
  Checker 为 https://shazhou-ww.github.io/potential-guide/schemas/artifacts/checker/v1.json，
  Objective 为 https://shazhou-ww.github.io/potential-guide/schemas/artifacts/objective/v1.json。
  这是本构想确定的契约地址，不表示已发布；实现与发布可用性仍需验证。
  既有 schemas/objective-artifact/v1.json 和其他历史 schema 原样保留，不覆盖或重新解释。
- 无制品内 id、version、format、defaultLanguage；来源引用在外部，准确内容由 digest 固定。
- Checker 无 protocol 或 resultSchema。一个 Checker schema 同时固定其支持的 runtime
  加载/调用约定、生命周期、输入上下文、统一结果及错误契约。
- Checker 顶层声明 entry 与 runtime:{type,minVersion}；entry 是制品内相对入口，
  不再使用 worker 字段。worker、线程或子进程属于 Host 实现，不是制品身份。
- 两类制品均声明 languages；不声明 resources 或 references 索引。

## Checker 示例

```text
checker/
├── checker.yaml
├── checker.cjs
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
$schema: https://shazhou-ww.github.io/potential-guide/schemas/artifacts/checker/v1.json
runtime:
  type: node
  minVersion: "22.13.0"
entry: checker.cjs
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
业务不达标。入口调用 envelope 到 HTTP Task result 的映射必须统一，实施时明确一次，
不可有的消费者拿 envelope、有的消费者拿 payload。

## Runtime 与跨语言边界

v1 的 runtime.type 仅接受 node，entry 是制品内安全相对路径，指向自包含的 CommonJS
入口；示例 checker.cjs 是文件名，不是 Host worker 管理接口。minVersion 必填，使用
明确的 major.minor.patch 稳定版本号，按数值版本比较，不接受范围、预发布或 build 后缀。
示例最低版本为 22.13.0；作者按实际要求声明，Host 同时遵守自己的支持及安全策略。
版本满足下界只是必要条件，不绕过运行时类型、平台、加载契约或授权检查。

Host 不具备声明的 runtime 或实际版本低于 minVersion 时明确失败，不自动安装、
降级或换用其他 runtime。声明的要求与实际执行环境分开；实际类型、版本及影响执行的
平台/adapter 配置进入证据和执行兼容判定，不能仅凭相同制品 digest 跨环境复用。
恢复仍需匹配原有准确执行证据，不能把“也满足最低版本”当作同一执行环境。

Objective 自身无 runtime，也不要求引用的 Checker 使用同一种 runtime。未来扩展
Python 等 Checker 时，各自通过对应 adapter 执行，Objective 只依赖统一输入、结果、
问题和文档契约。当前 v1 仍只支持 Node，其他类型明确拒绝；未来采用新 schema 扩展，
不修改已发布 v1 或声称已经交付 Python。Python 的依赖打包和隔离另行定义，
不能仅换入口扩展名便视为可运行。

Host 实现语言不等于 Checker runtime。HTTP/JSON/SSE、schema、摘要及业务生命周期是
语言无关协议；Node 的 AbortSignal、Promise、Worker 等是 adapter 内部实现。
跨语言实现须遵守同一 YAML/JSON Schema 方言、数值与 JSON 规范化、UTF-8 路径和
排序规则。subjectMapping 的受限 JSONata profile 须以可移植语义及测试向量定义，
不能依赖 JS AST 形状、缺失值或路径函数的隐式行为来定义协议。

## Objective 示例

```text
objective/
├── objective.yaml
└── references/
    └── zh-CN/
        ├── objective.md
        ├── levels/
        │   ├── structured.md
        │   └── verified.md
        └── checkers/
            └── layout/
                ├── checker.md
                └── problems/
                    └── invalid-layout.md
```

```yaml
$schema: https://shazhou-ww.github.io/potential-guide/schemas/artifacts/objective/v1.json
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
    url: https://example.com/checkers/layout/1.0.0/checker.tgz
    digest: "sha256:<64 hex>"
    subjectMapping: '{"root": root}'
  tests:
    url: https://example.com/checkers/tests/1.0.0/checker.tgz
    digest: "sha256:<64 hex>"
    subjectMapping: '$'
```

示例 URL 和摘要仅作格式说明，不是可用发布制品。局部名字 layout/tests 不是全局身份。
levels 保序且累积，initial/terminal 沿用既有内建语义。等级只列局部 Checker 名称，
不重复筛选 problems；每个 Checker 的完整通过条件均须满足。

Objective 内每个 Checker 引用必须同时提供固定版本 URL 和预期 digest。它固定的不仅是
执行代码，还有 subjectMapping 所需输入契约、problem 词汇及 References override
目标。升级 Checker 必须显式更新引用并重新校验 Objective，从而产生新的 Objective
digest；不允许 manifest 内的 Checker 在运行时追 latest。用户直接调用 Host 时仍可
提交浮动 URL、不提供 digest，这是外部选版入口而非制品内部组合。

subjectMapping 明确是从 Objective subject 到 Checker subject 的受限 JSONata。
显式 $ 表示传递全部 subject；无隐式缺省映射。禁止文件/网络/环境读取和未授权扩展，
有界求值，结果为有限 JSON 对象并通过 Checker subjectSchema。

## References 与语言

目录决定页面 ID 和语言；frontmatter 只保存 title、description 和可选 references，
不重复语言或 ID。每种语言的 Objective 总览直接位于
references/<language>/objective.md，对应页面 ID objective，与 Checker 顶层
checker.md 对应页面 ID checker 对称。新 Objective 不含 system/ 目录，
不声明 system/overview、system/404、404.md 或任何缺页 fallback。
每种声明语言都必须有有效总览；缺少必需页属于制品校验错误，不以 fallback 补齐。
未知页面请求由 Host 明确返回 not-found，不把总览或其他页面冒充所请求页面。
Checker 原页继承与局部 override 属于确定的页面组合，不是缺页 fallback。
历史格式的页面与 fallback 按原契约处理，不静默映射到新页面 ID。

示例问题页面：

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

Objective 的 references/<language>/checkers/<local-ref>/ 是所引用 Checker 文档的
局部 override，不是新增 Checker 或修改原制品：

- checker.md 覆盖该引用的 Checker 总览，对应有效页面 ID checkers/<local-ref>。
- problems/<problem-id>.md 覆盖该引用的问题页面，对应
  checkers/<local-ref>/problems/<problem-id>。
- 文件可省略；省略时继承原页，存在时替换该语言的整页（正文与 frontmatter）。
- 覆盖只影响当前 Objective 的该局部引用；同一 Checker 的其他引用或其他 Objective
  不受影响。同一引用在多个 level 出现时使用同一份覆盖。
- 不得借文档覆盖改变 subject/result 契约或增加未声明的 problem；原始页面仍可通过
  base 页面访问，覆盖页与原页分别保留各自 owning digest/path。

目录和有效页面命名空间统一为 checkers，不再使用旧 checks 命名空间；旧格式按原规则
读取，不静默重解释。YAML 的 levels[].checks 仍表示等级的检查条件，保留该字段名。

languages 表示完整支持的有效文档语言。Objective 可通过本地覆盖补齐 Checker
缺失的语言；无继承内容且未补齐时不得声明支持。Host 配置有序语言偏好：
显式请求必须支持，省略时选第一种可用语言，无交集明确失败。有效语言在受理/准备
过程中固定并返回快照；配置变化不改已有任务，语言影响输出时参与共享兼容判定。
缓存制品不写入 Host 默认语言。

## 无额外资源

新 Checker 仅包含 checker.yaml、entry 指定的单个自包含 CommonJS 文件和规范 Markdown；Objective 仅包含
objective.yaml 和规范 Markdown。其他文件、链接、特殊文件和歧义路径明确拒绝，
不忽略或自动打包。无 raw resource API，也不承诺 Markdown 附件能下载。
保留页面 API；继承页面的来源仍准确，不能制造不可用的资源地址。

旧 Checker 的资源须作者显式内联 bundle、迁移或走有界兼容路径，不能直接删除。
不安装消费端依赖、不运行下载内容的构建或生命周期脚本。

## 动态依赖与迁移

不恢复 Objective 制品内的静态 prerequisite；当前修订仅在 Regulation Task 调度层增加
prerequisites Check 集合。Check/Probe 没有业务启动前提，但仍可报告动态 requirements；
不写回制品或要求作者维护依赖 Objective 清单。运行时需求带可解析的
带类型来源引用；首次解析受来源/执行授权约束，并在本次观察内固定 digest。Regulation
传入/保存准确绑定以支持连续重查和恢复；既有绑定不匹配时失败，不悄悄升级。
依赖循环、深度、总预算与绑定冲突仍有界检查。多来源同内容不能越过权限边界共享。

去掉 objectiveId 不只是删 manifest：声明、依赖结果、versions/sources、Coordinator
键、历史恢复和证据必须一起适配。旧格式不改写；新 schema、摘要规则与显式迁移分开。
YAML 只接受有限 JSON 子集，拒绝重复键、自定义 tag、别名扩张及隐式非 JSON 值，
保留体积/深度/路径限制。不把 YAML 重排、换行转换或 Unicode 修复当成无损处理。
