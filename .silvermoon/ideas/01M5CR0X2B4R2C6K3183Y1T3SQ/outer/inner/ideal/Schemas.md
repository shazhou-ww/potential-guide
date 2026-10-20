# Schema 逐项讨论清单

本文保存规范讨论及逐项评审意见，不是已批准的完整格式设计。局部明确的修改方向与待讨论建议分别记录，不因排列顺序或候选建议而自动定案。

可使用离线 [HTML 评审文档](./Review.html) 逐页阅读用途、用例、代表性示例、TypeScript 类型和 YAML 表达的 JSON Schema 草案。报告与 monorepo 的两种格式分别成页，共 11 页；各页注明展示范围及未展开的语义，不作为已发布规范或生产 validator。

## 讨论起点

- 用户提出应先区分开放协议与内部数据，而不是给所有数据格式统一加版本号。
- 用户提出使用公开位置的 schema 文件标识公共格式；这是本轮要进一步细化的方向。
- 公开 schema URI 替代独立数字版本、不可变发布、随包离线校验和未知 URI 拒绝均为候选方案，尚未逐项确认。
- 内部持久化是否保留存储版本，以及哪些输出需要公开兼容承诺，仍需分别决定。

## 逐项清单

| 顺序 | 格式 | 当前版本 | 初步分类，待确认 | 主要讨论点 |
| --- | --- | --- | --- | --- |
| 1 | Pilot Manifest | 1 | 公共核心协议 | 契约范围、标识字段、嵌入 domainSchema 的方言与语义校验。 |
| 2 | Objective 声明文档 | 1 | 公共声明格式 | 文档与条目的边界、输入 schema 和投影的校验责任。 |
| 3 | CLI 配置 | 2 | 公共配置格式 | 组件归属、配置合并、旧格式与新标识的兼容规则。 |
| 4 | Portfolio 输入 | 3 | supervise 公共输入 | 与核心协议的边界、引用及跨字段约束。 |
| 5 | Regulation 恢复记录 | 3 | 内部持久化 | 是否保持内部存储版本、完整读取校验与升级处理。 |
| 6 | regulate / supervise 报告 | 2 / 3 | 公共或内部输出待定 | 是否承诺第三方消费与历史读取，是否共享外层标识。 |
| 7 | 通用 CLI JSON 输出 | 1 | 机器接口范围待定 | 哪些响应稳定公开，如何区分响应类型与版本。 |
| 8 | Evidence JSONL | 1 | 诊断或开放事件流待定 | 是否支持长期读取和第三方分析，标识放在记录还是流级。 |
| 9 | monorepo Objective Contract / Report | 1 | 具体 Objective 业务格式 | 用户输入与内部模型的区别，是否需要独立公共 schema。 |

## 每项需要明确的问题

1. 谁生产和消费，是否跨程序版本或存在独立的第三方消费者？
2. 是否作为公共契约承诺稳定性，定义及校验应归哪个组件？
3. 是否需要版本标识；若采用 schema URI，如何确定身份、发布位置及不可变性？
4. 哪些约束由 JSON Schema 表达，哪些必须由语义校验完成？
5. 旧格式、未知标识与离线消费如何处理，如何证明行为符合规范？

## 当前讨论入口

先讨论 Pilot Manifest 的契约边界及标识方式；公共地址、迁移方案和实现细节留待对应决定，不使用示意域名充当真实发布地址。

## Pilot Manifest 第一轮评审（2026-10-20）

以下是下一步规范化修改的输入，不是构想整体验收或运行时变更授权。HTML 的示例、类型与 schema 仍保留当前源码快照，避免将讨论中的格式伪装成已支持的格式。

### M-01：扁平化级别检查节点

用户已明确修改方向：去掉 `levels[].advancement`，直接使用 `levels[].checks`。该包装目前仅包含 checks，没有独立信息；规范化时应保留既有级别顺序、检查执行和推进语义，不能将结构简化误作行为变化。

后续实施需同步类型、解析器、观察逻辑、作者文件、生成模板、运行时副本、测试及文档；旧格式处理随整体格式标识与兼容策略决定，本轮不自行指定版本或兼容别名。

### M-02：domainSchema 改名为 subjectSchema（已确认）

状态：用户于 2026-10-20 明确同意此建议，作为下一步规范化修改方向。字段改为 `subjectSchema`，因为它直接验证传给 Pilot 的 subject，与 `inputSchema` 形成“调用输入 / 观察对象”的清晰对应；`domain` 更偏抽象概念，不能直接说明被校验的数据。

这个改名只澄清字段职责，不代表扩大 subject 的取值范围，也不预先决定相关 API 的最终名称。

### M-03：JSON Schema 类型及支持范围（已确认）

状态：用户于 2026-10-20 明确同意采用标准 JSON Schema，不另造简化类型语言，不主动设置关键词白名单，只施加必要约束。TypeScript 类型表达与运行时支持的 schema 能力分开定义，不能因为把字段从 `JsonObject` 换成一个类型名称，就认为完成 schema 校验。

当前实现采用 Ajv Draft 2020-12 严格编译，要求 Pilot 的根 schema 显式声明 `type: object`，`$schema` 若出现须为 Draft 2020-12，并把 `$ref` 限于本地 `#/$defs/` 引用。

已确认的规范方向如下：

- TypeScript 使用匹配 Draft 2020-12 的 schema 类型表达，并明确根对象约束；具体类型来源待选，不把不同方言的类型混用，也不直接把整个 manifest 业务类型当作 subject 类型。
- 保持 subject 为 JSON 对象；嵌套字段仍可包含标量、数组和对象，不因根对象约束而限制业务表达力。
- 初期仅支持文档内的 `$defs` 引用，不自动联网取得远端 schema。保留运行时 schema 合法性检查与 subject 实例校验，不宣称支持所有扩展、format 或远端引用。
- 保留标准嵌套、数组、枚举、组合约束等表达能力，不另造简写或维护无必要的关键词白名单；非法或运行时不支持的定义明确报错，不静默忽略。

schema 类型的具体来源及公共依赖归属仍为实施选型，不将其误记为已选定的库。manifest 自身的格式标识、旧格式兼容及公共 schema 发布位置仍待后续讨论。

### M-04：改名为 Objective Manifest / objective.yaml（已确认）

状态：用户于 2026-10-20 明确同意改名，并要求其他数据格式中的相关引用同步改名。静态定义称为 Objective Manifest，文件名使用 `objective.yaml`，让名称对应其描述的目标、subject 约束、级别、检查和参考文档；Pilot 则保留为读取该定义并进行观察的执行角色，不表示 manifest 是可直接执行的运行时。

需明确单数 `objective.yaml` 是一个目标定义入口，复数 `objectives.yaml` 是目录提供的命名调用声明，负责选择定义并绑定 input/context 到 subject；后者不是多个完整 manifest 的集合。数据格式引用的统一改名见 M-05；CLI 参数与包名仍按职责分别核对，不把本项决定自动扩大成全部标识符的机械替换。

实施范围需覆盖固定入口解析、作者文件、生成模板、资源加载、错误提示、文档与测试，并显式决定旧入口如何处理。目录 Objective URI 身份不必仅因入口文件改名而改变；内容树版本仍会随文件变化。

### M-05：所有数据格式的目标引用统一使用 objective（已确认）

状态：用户明确要求，不仅重命名 manifest，其他数据格式里凡是引用目标定义的 `pilot` 也统一改为 `objective`。该规则同时覆盖公共输入、业务输出、嵌套快照和内部持久化，不因格式是否公开而保留混用术语。

| 当前引用 | 规范化方向 | 主要位置 |
| --- | --- | --- |
| `pilot` | `objective` | Objective 命名调用声明、Portfolio goal，以及其他引用目标定义的嵌套字段。 |
| `pilotUri` | `objectiveUri` | Regulation 恢复记录等目标定位字段。 |
| `pilotCommit` | `objectiveCommit` | 固定目标来源的取回 commit。 |
| `pilotTree` | `objectiveTree` | 目标目录内容树版本。 |
| `pilotSource` | `objectiveSource` | 目标来源证据。 |

已有 `objectiveId`、`objectives`、`sourceBindings` 等字段不因这条命名规则而无故再改名。重命名只统一指代，不混淆 URI、目录 tree、取回 commit 与来源证据，也不更改绑定、观察或恢复语义。

后续实施需逐项覆盖各数据格式及其 TypeScript 类型、JSON Schema、生产者、消费者、生成文件、示例和测试，包括嵌入报告、队列或声明快照的目标引用。真正表达 Pilot 执行角色的运行时标识符不作盲目替换；旧字段和旧入口的兼容或拒绝策略仍待整体决定。本轮仅记录规范化计划，不实施格式迁移或记录整体验收。

## Objective 声明第一轮评审（2026-10-20）

### O-01：目标定义引用命名（已确认）

声明条目的 `pilot` 改为 `objective`，遵循 M-05；仍引用目标定义目录，不改变命名调用、路径解析或 subject 绑定职责。

### O-02：inputSchema 为可选 JSON Schema（修改方向已明确）

用户要求 `inputSchema` 使用标准 JSON Schema，并设为可选；省略时按空 schema `{}` 处理。该 schema 校验的是调用者的 `input`，不是包含 context 的求值根对象。采用与前述一致的 Draft 2020-12 方言及离线引用边界，但不照搬 subjectSchema 的根对象要求，input 仍可由其 schema 声明为任意 JSON 类型。

必须区分三件事：

- `inputSchema: {}` 是接受任意 JSON 值的空 schema，字符串、数组、对象和 null 都可通过，不是 Unit 约束。
- `inputSchema: { const: {} }` 才表示只接受空对象值；与省略 schema 不等价。
- 调用者没有提供 input 时，求值根的 `input` 默认为什么，是独立的调用约定，不能从空 schema 自动推导。

现有实现要求显式 inputSchema，且只允许 Unit 输入省略实际 input，故本项是待实施的行为变化。Agent 建议后续将缺省 input 归一化为 `{}` 并按有效 schema 校验，显式提供的 null 或其他 JSON 值保留；与既有 Unit-only 省略规则的取舍仍待用户确认，不在本轮擅自定案。

### O-03：subject 的 JSONata 求值入参（当前机制说明）

已核对当前调用链：工具构造 context 并取得调用者 input，协议层以单个根对象 `{ context, input }` 求值 subject 表达式。二者是根对象的命名属性，不是两个位置参数，也没有注册 `$context` / `$input` 自定义变量。

当前工具构造的 context 主结构如下；这描述当前实现，不自动视为已经冻结的公共 context 规范：

```ts
interface ObjectiveContext {
  repository: { id: string } | null;
  checkout: { id: string; rootPath: string } | null;
  directory: {
    absolutePath: string;
    relativePath: string | null;
  };
}
```

`directory` 来自调用工作目录。Git 内 relativePath 为仓库相对路径，根目录用 `"."`；非 Git 目录的 repository、checkout 和 relativePath 为 null。context 是工具提供的环境事实，不是用户 input，也不隐式开放 process、env、文件系统或网络。

例如根值为：

```json
{
  "context": {
    "repository": { "id": "https://example.test/team/repo.git" },
    "checkout": {
      "id": "urn:pguide:checkout:example",
      "rootPath": "D:\\work\\repo"
    },
    "directory": {
      "absolutePath": "D:\\work\\repo\\packages\\api",
      "relativePath": "packages/api"
    }
  },
  "input": { "mode": "full" }
}
```

则 subject 表达式 `{"directory": context.directory.absolutePath, "mode": input.mode}` 产生 `{"directory":"D:\\work\\repo\\packages\\api","mode":"full"}`。后者再按目标定义的 subjectSchema 校验，context 不被自动塞入最终 subject。

当前执行的是确定性、有边界的 JSONata 投影 profile，而不是允许任意函数、变量和动态执行的完整 JSONata 运行时；缺失路径按当前 requireDefined 规则报错。投影根结构建议保留，context 字段的稳定公开范围及 input 缺省规则仍需分别确认。
