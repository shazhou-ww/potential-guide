# 作者 Build YAML 与依赖固化

本文服务于 [Idea](Idea.md)，补充 [成品格式](Objective-format.md)。
以下是作者配置候选，不是现有 CLI 可执行配置。来源解析器与正式机器 Schema 待实施落实。

## 三层边界

1. 作者描述：普通作者工程中的 `objective.build.yaml`，声明选择哪些 Check 和如何组合。
2. 构建解析：将来源固定为精确 Check 根 CID，获取、验证并组装完整内容。
3. 不可变成品：仅包含内部引用、目标声明和完整闭包，运行时不再查询 publication。

作者不需要预先物化 Check、维护本地 IPFS 节点或运行 Kubo；
构建器必须能获取全部内容块，仅获知 CID 不足以完成自包含交付。
普通 publication URL 是可变的选择入口，不是内容身份。

## objective.build.yaml 候选

```yaml
name: Development Environment
languages: [zh-CN]

bundles:
  environment:
    source:
      kind: publication
      url: https://example.test/publications/environment-check
  project:
    source:
      kind: ipfs
      cid: <Check-root-CID>

objective:
  subjectSchema:
    $ref: schemas/subject.json
  checks:
    tools:
      bundle: environment
      inputMapping: '{"root": root, "kind": "tools"}'
    network:
      bundle: environment
      inputMapping: '{"root": root, "kind": "network"}'
    project:
      bundle: project
      inputMapping: '{"root": root}'
  levels:
    - id: prepare-environment
      checks: [tools, network]
    - id: verify-project
      checks: [project]

schemas:
  - from: ./contracts/subject.json
    to: schemas/subject.json

referenceRoot: ./docs
references:
  zh-CN:
    objective: objective.md
    levels:
      prepare-environment: levels/prepare-environment.md
      verify-project: levels/verify-project.md
      terminal: levels/terminal.md
    checks:
      tools:
        check: tools/check.md
        problems:
          missing: tools/problems/missing.md

resources:
  - from: ./docs/assets/environment.svg
    to: references/assets/environment.svg
```

`example.test` URL 和 CID 是占位，不代表已验证的 Pinboard API。
作者 YAML 不需要自己的最终 CID，也不包含 Objective Worker、Node 入口或 contract 模块。
对象 Schema 可以内联；需要外部作者文件时，显式文件映射将它收录到成品根内。

### 作者字段如何生成成品

| 作者字段 | 含义与成品投影 |
| --- | --- |
| `name`、`languages` | 投影为成品展示名和支持语言。 |
| `bundles` | 作者侧制品绑定表；每项解析一次并嵌入 `checks/<binding>`。 |
| `source.kind: ipfs` | 直接使用精确 CID；具体传输 endpoint 属于构建配置，不是内容身份。 |
| `source.kind: publication` | 通过支持的渠道解析确定发布版本和 CID，非任意网页内容下载。 |
| `objective.checks` | 逻辑引用及映射；`bundle` 从绑定名改写为根内 `checks/<binding>` 路径。 |
| `objective.levels` | 按原顺序投影，遵守新的目标阶段语义。 |
| `schemas` | 显式快照作者文件并放入成品，不保留依赖作者工程路径的 `$ref`。 |
| `referenceRoot`、`references` | 作者文件相对 root 选择；生成成品中规范的逐语言页面路径。 |
| `resources` | 收录显式支持资源，保持页面相对链接所需的目录关系。 |

两条逻辑引用可绑定同一份制品。未使用的制品绑定应报错，避免意外扩大执行闭包。
若两个绑定解析到同一 CID，底层块可以去重；是否合并作者绑定名不改变逻辑引用语义，
无需为此自动改写用户的命名。

当前候选采用独立 `bundles` 表，避免作者制品名与逻辑 Check 名混淆，
也避免先前示意中顶层 `checks` 与 `objective.checks` 的同名歧义。
这是本次整理的字段建议，不代表已冻结的格式。

## 构建顺序与失败边界

1. 验证作者配置、精确路径、阶段引用和页面声明；快照作者文件。
2. 解析每个来源，获得精确发布版本与 Check 根 CID；一次构建只解析一次同一来源。
3. 获取完整 DAG，验证所有块哈希、可达性及 Check Bundle 声明/资源契约。
4. 根据 Check 元数据验证逻辑引用、Problem Override 和各语言有效页面覆盖。
5. 生成成品 YAML、Schema、References 和资源；引用已验证的原 Check 子树。
6. 导出并验证完整 Objective CAR，得到根 CID；成功后才接受成品和固化记录。

发布入口没有明确内容身份、内容缺失、哈希不符、格式不支持、无权访问、
映射错误或文档覆盖不完整均显式失败。不执行 Check 来发现静态契约，
不重新编译、不安装其依赖，不用可变 URL 的下一版本补救失败。
失败不能替换上次已接受的成品或锁定记录。

Pinboard 是预期支持的来源渠道，但需按实际 publication API 证明
“发布版本到完整 Bundle 根 CID”的解析规则。不得假定普通页面 URL、附件 CID、
下载文件 CID 与 Check Bundle 根 CID 相同。授权与 credential 不写入可恢复成品或锁文件。

## 固化与可复现

固定的 Objective 根天然锁定本次依赖。相同作者 YAML 引用移动 publication 时，
再次解析可能得到不同 Check，因此“成品不可变”不等于“作者输入可复现”。

建议构建同时输出独立解析记录或 lock，按绑定记录：

```text
作者来源 → 确定发布版本（如有） → 已验证 Check 根 CID
```

该记录不把 Objective 根 CID写回自身文件树。完整成品根 CID可写入根外的构建凭据。
更新模式重新选择来源并生成新的候选记录；锁定模式仅使用已有精确 CID，
内容不可用即失败，不查询 latest 代替。
具体锁文件名、CLI 更新操作、source fingerprint 与 snapshot 格式留待实施细化；
锁定来源的变化必须显式识别，不能继续使用与当前作者声明不匹配的旧记录。

固定作者快照、精确依赖和同一规范 UnixFS 组装策略应得到同一根；
重新物化后用不同上传默认值构建，不构成复现保证。

## 成品中不保留作者运行依赖

消费者不需要 `objective.build.yaml`、作者工程、发布服务或锁文件来验证和解释成品。
成品包含 `objective.yaml`、收录文件和全部 Check 子树。
来源 URL 如用于 provenance，只能是被动记录，不成为运行时获取代码的入口。
固定闭包上传与 pin 是独立渠道操作，构建 CAR 成功不等于已发布或持续可用。
