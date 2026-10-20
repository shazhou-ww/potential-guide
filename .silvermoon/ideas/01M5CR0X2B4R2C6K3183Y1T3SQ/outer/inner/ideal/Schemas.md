# Schema 逐项讨论清单

本文保存规范讨论及逐项评审意见，不是已批准的完整格式设计。局部明确的修改方向与待讨论建议分别记录，不因排列顺序或候选建议而自动定案。

可使用离线 [HTML 评审文档](./Review.html) 逐页阅读用途、用例、示例、TypeScript 类型和 YAML 表达的 JSON Schema，共 12 页。2026-10-21 已将各页更新为源码 `fd591b9ddc2af389151cfdd7bebb0ec5cfd4d0a7` 的当前实现，而非继续展示最初评审快照：Objective Manifest、声明和 Agent 页展示与三份已发布 Schema 相同的定义；Portfolio 与恢复记录同步 objective 字段。未发布格式仍标注解释用草案及简化范围，JSONC 单独标注未实施提案。下方历次评审文字保留讨论过程，当前实现以 HTML、公开 Schema 和三个已完成子 IDEA 的交付证据为准。

## 讨论起点

- 用户提出应先区分开放协议与内部数据，而不是给所有数据格式统一加版本号。
- 用户提出使用公开位置的 schema 文件标识公共格式；这是本轮要进一步细化的方向。
- 公共格式已确认以 schema URI 替代独立数字版本；域名和发布位置尚待选择，详见 G-01。随包离线校验及未知 URI 明确拒绝作为既有设计方向，不依赖运行时任意下载。
- 内部持久化是否保留存储版本，以及哪些输出需要公开兼容承诺，仍需分别决定。

## 逐项清单

| 顺序 | 格式 | 当前版本 | 初步分类，待确认 | 主要讨论点 |
| --- | --- | --- | --- | --- |
| 1 | Pilot Manifest | 1 | 公共核心协议 | 契约范围、标识字段、嵌入 domainSchema 的方言与语义校验。 |
| 2 | Objective 声明文档 | 1 | 公共声明格式 | 文档与条目的边界、输入 schema 和投影的校验责任。 |
| 3 | CLI 配置 | 2 | 公共配置格式 | 组件归属、配置合并、旧格式与新标识的兼容规则。 |
| 3a | Agent 定义 | 拟从 CLI 配置中独立 | 结构化命名资源 | agents.yaml 的结构、作用域、校验与 pguide agents 管理边界。 |
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

当前推进到 CLI 配置拆分与分段配置规则。前面明确的局部意见按各节记录；公共地址、迁移方案和实现细节留待对应决定，不使用示意域名充当真实发布地址。

## 分拆实施的关联 IDEA

按用户要求，将已明确方向拆成三个独立生命周期的关联 IDEA；这里只通过文档建立总分关系，不向 Silvermoon 虚构 parentId、依赖事件或已获验收状态。

| 建议顺序 | Alias 与入口 | 独立范围 | 准备阶段仍需收敛 |
| --- | --- | --- | --- |
| 1 | [objective-contracts](../../../../01M5CX0VMQ080XYSX96ZDCCTZS/outer/inner/ideal/Idea.md) | Objective Manifest、checks 扁平化、subjectSchema、跨格式目标引用、URI 与显式迁移。 | canonical URI 地址与实例标识字段；GitHub Pages 仍为建议。 |
| 2 | [objective-bindings](../../../../01M5CX3F7EGCVZ3F7EEJWY1BJ1/outer/inner/ideal/Idea.md) | Unit 缺省声明、repo/path context、普通 pathJoin 和受限投影。 | 路径函数签名及非 Git 声明使用约定，沿用第一项的格式身份与迁移策略。 |
| 可独立准备 | [agent-config-separation](../../../../01M5CX5GG5NDS07N4V3QQ4N7ZA/outer/inner/ideal/Idea.md) | agents.yaml、pguide agents、用户/项目作用域、所有 Agent 消费者与迁移。 | 文件结构与位置、同名覆盖及最小命令集。 |

第二项的目标引用改名由第一项拥有，避免两边重复实施；第二项补足输入和投影行为，不重新设计来源身份。Agent 独立化不要求主配置先改为 JSONC。公共 schema 发布策略应保持一致，但不把这表述成 Agent 文件已部署。

### 本轮实施授权与准备决策

用户明确要求 subagents 实施，由主 Agent 负责各阶段门限审批；除无法合理决断的问题外不必暂停询问。此委托允许逐阶段代理审查与准确 revision 的审批，不代表未经检查的批量验收，也不授权 npm 发布或秘密处理。

主 Agent 在该授权下收敛实施所需的普通准备决策：canonical schema 使用既有项目 GitHub Pages 身份的 `/schemas/<format>/v1.json`，实例字段为 `$schema`；尚未启用 Pages，后续须实际验证部署。路径函数固定为两个字符串，非 Git 的投影直接使用 context.path；Agent 文件采用 `$schema` + agents，放在用户/项目原主配置目录旁，同名完整 profile 由项目级覆盖；管理操作采用 list/show/set/remove/edit/validate/path/migrate。实际文件和旧格式迁移须保持原子写入、脱敏及现有信任边界。

后续引用以上三个子 IDEA 的当前方向卡作为实施与门限依据；旧表格中的准备问题由本节及子 IDEA 的准确 revision 取代。JSONC 主配置仍不在这三项的实施范围内。

总 IDEA 继续承载剩余数据格式评审，以及 JSONC、扩展配置描述、namespace 和合并策略的讨论。这次创建不代替任何子 IDEA 的 exact revision 验收，不进入实施、不发布包；各自保留方向卡、轻量实施/部署种子和未勾选 ledger。

## Pilot Manifest 第一轮评审（2026-10-20）

### G-01：公共格式标识与旧格式处理（已确认）

用户明确同意公共数据格式用 URI 标识契约，旧格式统一拒绝并提供迁移，不提供过渡期兼容读取或静默字段别名。这里的决定覆盖本轮改造涉及的旧 manifest 入口、结构、字段、声明及旧 CLI 配置；迁移是显式操作，不是普通读取时自动改写。后续各节提及旧格式“待决定”的历史表述均以本决定为准。

公共 schema URI 同时标识格式与版本；已发布地址对应的定义保持不可变，变更定义应发布新的标识，不能只保证不兼容变更才换地址。离线运行时使用随包的对应定义，不按实例中的任意 URI 联网解析。schema 文件自身的 `$schema` 仍表示 JSON Schema 方言，与业务文档用于识别契约的 URI 不同。

域名尚未定案。Agent 建议优先采用项目长期控制的域名下的 `/schemas/<format>/<revision>.json`，而不是购买或假定已拥有某个名称。如果当前没有自有域名，可先规划 GitHub Pages 的 `https://shazhou-ww.github.io/potential-guide/schemas/objective/v1.json` 等地址，利用现有 GitHub 身份，不依赖 moving main 的 raw 文件链接。该示例尚未部署，不能当作可访问的 schema；Pages 托管也不自动保证不可变，需发布检查保护已发布文件。最终 canonical URI 应在正式写入用户文件之前确定，后续更换托管域名会留下旧 URI 的长期维护责任。

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

### O-02：inputSchema 可选，省略为 Unit schema（已澄清）

用户明确澄清：`inputSchema` 使用标准 JSON Schema，并设为可选；省略时等价于 `inputSchema: { const: {} }`，即只接受空对象值的 Unit schema，不是接受任意 JSON 的空 schema `{}`。此澄清替代上一轮对省略含义的解释。该 schema 校验调用者的 `input`，不是包含 context 的求值根对象。采用与前述一致的 Draft 2020-12 方言及离线引用边界，但显式 inputSchema 不照搬 subjectSchema 的根对象要求，仍可声明其他 JSON 类型。

规范化计划保持以下区别：

- 省略 inputSchema 或显式 `inputSchema: { const: {} }`：采用 Unit 约束；实际 input 可以省略并归一化为 `{}`，JSONata 求值根仍包含 `input: {}`。
- 对上述 Unit 约束，显式输入 `{}` 有效，非空对象、数组、字符串、数字、布尔值或 null 均无效，不得将显式 null 当成缺省输入覆盖。
- 显式 `inputSchema: {}`：仍保留标准 JSON Schema 的任意 JSON 语义，与省略 inputSchema 不等价。

现有实现要求显式 inputSchema，因此未来需要在声明解析时为省略字段归一化出 Unit schema；本轮不实施。上一轮“任意 schema 下未提供实际 input 都默认成 `{}`”的建议不作为决定，不扩大既有 Unit-only 省略规则。声明原始输入类型可选与归一化后内部类型必有有效 schema 的区别，在实施时保持清晰。

### O-03：subject 的 JSONata 求值入参（现有实现快照，非新 context 规范）

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

当前执行的是确定性、有边界的 JSONata 投影 profile，而不是允许任意函数、变量和动态执行的完整 JSONata 运行时；缺失路径按当前 requireDefined 规则报错。本节保留现有实现作为迁移依据；新 context 结构见 O-04，Unit 缺省输入规则见 O-02，不将旧字段当作已确认的新公共契约。

### O-04：context 收敛为 repo 与 path（结构已确认）

用户明确要求 context 只有两项信息：`repo` 和 `path`；`repo` 中包含 `rootPath` 与 `origin`。新的 Git 场景结构如下，取代旧的 repository / checkout / directory 分组，不默认保留旧字段别名：

```ts
interface GitProjectionContext {
  repo: {
    rootPath: string;
    origin: string;
  };
  path: string;
}
```

JSONata 求值根仍为 `{ context, input }`，表达式通过 `context.repo.rootPath`、`context.repo.origin`、`context.path` 和 `input` 取值。context 仍由工具提供，不允许用户 input 覆盖，不自动暴露进程环境、秘密值或文件系统能力。origin 表达实际仓库来源，不把旧 repository.id 或 checkout.id 直接改名后冒充来源。

用户已同意：Git 内 `path` 采用仓库相对路径，根目录为 `"."`；非 Git 目录中 `repo: null`，`path` 为调用目录绝对路径；Git 仓库没有 origin 时 `repo.origin: null`，不得伪造来源。仓库相对部分使用 `/` 是当前规范化建议；origin 的具体 URL 规范化与错误分类在实施时进一步明确。

目标结构据此扩展为：

```ts
interface ProjectionContext {
  repo: { rootPath: string; origin: string | null } | null;
  path: string;
}
```

`repo === null` 时不可读取 `repo.rootPath`；作者应选择适合非 Git 调用的投影。现有受限 JSONata 不具备完整条件表达式能力，因此是否需要在同一声明中同时处理两类场景属于后续表达式能力讨论，不能为此隐式开放任意 JSONata。

### O-05：支持跨平台路径拼接函数（方向已确认）

用户同意在 JSONata 不提供路径拼接内置函数的情况下，增加一个用于抹平系统差异的函数。已验证已安装 JSONata 的 `$join` 仅拼接字符串数组，没有绑定 `$pathJoin`；`$join([root, path], "/")` 不提供路径规范化语义。

规范化计划使用显式扩展函数 `$pathJoin(root, path)`，让作者可写：

```jsonata
{
  "directory": $pathJoin(context.repo.rootPath, context.path)
}
```

设计方向是按宿主路径语义计算本地路径：Windows 生成本地反斜杠路径，POSIX 生成斜杠路径。抹平差异指相同表达式可移植，不要求不同系统生成完全相同的字符串。函数只做纯路径计算，不访问文件系统、不调用 realpath、不检查文件存在，也不据此宣称路径一定在仓库内。

当前项目以自有 AST 校验与求值器执行受限 JSONata，不是直接运行任意 JSONata 表达式；未来实现必须同时接入受限解析与求值，只开放明确的路径函数，不因原生 JSONata 的 registerFunction 可用就绕过现有能力、时限与输出边界。本轮仅用原生 JSONata 显式注册函数验证 Windows / POSIX 示例，未改变生产运行时。

用户已明确：这是普通 pathJoin，不做隐含承诺。按宿主 `node:path.join` 的普通语义拼接及规范化，不替换为 `path.resolve`，不附加“必须位于仓库内”的隐式规则；空路径、绝对片段、`.` 与 `..` 应以对应宿主 join 行为建立测试。参数类型、参数个数与既有输出大小边界仍需明确；这些输入检查不构成路径授权或沙箱。

## CLI 配置第一轮评审（2026-10-20）

### C-01：独立 Agent 定义文件与管理命令（用户提出的改造方向）

将现有主配置的 `agents` 剥离到独立 `agents.yaml`，新增 `pguide agents` 子命令管理。Agent profile 是带协议判别和嵌套结构的命名资源，独立格式应有对应类型、结构及语义校验；不能因主配置变为可扩展文本而放松 ACP / AHP 的验证和凭据保护。

Agent 建议主配置只保存“选择哪个 Agent”这样的名称引用，连接、传输、认证引用及会话要求等完整定义进入 agents.yaml。`agents:` 包装、公开 schema 标识、文件位置和作用域尚未定案；HTML 的 ACP 示例只是候选形状，不是新的有效配置。

`pguide agents list|show|add|edit|remove|validate|path` 为待讨论的命令组织示例，不代表已经冻结这些操作名。现有 config 的 Agent 增删改查迁移到独立入口，是否保留临时别名需显式决定；共享校验、脱敏、原子写入与错误提示不能分叉实现。

### C-02：主配置改为 Git 风格的可扩展分段配置（早期提案，正比较 VS Code settings 方案）

剩余通用配置不再以一个统一 JSON/YAML 树及全局 schemaVersion 作为唯一文件契约，而按 section/key 组织，使用 `pguide config` 读写。当前配置实际上是 YAML，并非仅限 JSON；本次目标是改变配置模型、扩展方式和管理语义，而非只更换文本后缀。

建议将通用选项、默认选择、报告、执行限额等分区。例如以下仅展示方向，不确定主配置文件名、section 名称或解析语法：

```ini
[core]
    defaultAgent = local
    language = zh-CN
    format = json

[reports]
    enabled = true

[agentExecution]
    timeoutMs = 300000
```

建议已知 key 的类型、默认值、约束与说明归使用该 key 的组件所有，主配置保留来源与作用域信息。可扩展不等于无校验：语法错误和已知 key 的非法值必须明确报错，未知 section/key 的保留、读写与消费规则要单独定义，不将“未知”静默转换为某种默认有效行为。

需区分“Git 风格语法和命令体验”与“完全兼容 Git config”。普通 INI、TOML 和 Git config 的引号、转义、重复 key、多值、子节及 include 语义并不等价；具体采用哪套规则仍待讨论，不先选解析器或承诺支持 include / includeIf。用户随后提出 VS Code settings 风格作为替代，见 C-05；本节的 INI 仅保留讨论背景，不代表最终文件语法。

### C-03：拆分后仍需明确的边界

- 用户明确初期只做用户级、项目级作用域，不预先扩展为第三套显式文件作用域；主配置与 agents.yaml 的实际位置仍需确定。Agent 同名覆盖建议以完整 profile 为单位，不做可能拼出无效协议组合的深合并，最终规则待确认。
- 默认 Agent 名称与有效 Agent 定义的交叉验证、未知名称错误、配置来源展示和写入目标必须一致；旧主配置及 Agent 定义如何迁移或拒绝待决定。
- `commandDirectories` 等多值配置如何表达；`regulationStrategy` 与 `regulationPermissions` 这类嵌套策略是否使用子节、命名规则或独立资源，尚未决定，不用 JSON 字符串塞回 key 值来假装完成拆分。
- schemaVersion 不是通用配置扩展的前提；若采用无全局版本的 key 模型，需要逐 key 定义兼容、弃用和非法值处理。agents.yaml 是否使用公共 schema URI 属于独立格式讨论。
- 项目级配置涉及可执行 Agent 命令及授权信任，原有边界不能因移动文件而默认为扩大。保留环境变量名等凭据引用，不写入明文秘密。

本轮只记录改造方向与待讨论问题，不创建真实配置、不新增可执行命令或依赖、不修改现有加载器，也不视为构想整体验收。

### C-04：所有扩展子命令可独立定义自身配置（用户明确要求）

分段主配置必须允许所有 extended subcommands（扩展子命令，包括独立安装的第三方命令）定义、演进和消费自己的配置，而不是只向核心内置命令开放 section。新增扩展 key 不要求发布新版主程序、修改全局 PguideConfig 类型或将其加入核心白名单。

建议将职责分为：

| 所属方 | 职责 |
| --- | --- |
| 配置基础设施 | 统一文本语法、文件作用域、合并优先级、来源信息和通用 get/set/unset；保留扩展配置，不因命令未安装而丢弃。 |
| 核心命令 | 定义并校验自身的公共/核心 key，不解释任意第三方 key。 |
| 扩展子命令 | 定义自己的 key、类型、默认值、约束、帮助与弃用规则；在消费前校验自身配置并显式报告非法值。 |

推荐使用可明确归属的命名空间，避免不同扩展与核心 key 冲突。例如以下仅为命名候选，不冻结 section 语法：

```ini
[commands "deploy"]
    target = staging
    timeoutMs = 60000
```

对应通用读写可表现为 `pguide config get commands.deploy.target`。命名空间建议按被发现的逻辑命令名归属，不按 npm 包名猜测；保留哪些核心名称、命令名冲突及跨 namespace 引用规则仍待确认。

存储能力与语义理解分开：未安装或未提供配置描述的扩展，其 key 仍可保留与读写，但不能把“成功保存”宣称为“扩展语义校验通过”。扩展自己的错误不应阻断无关命令读取有效配置；真正被消费的非法值必须显式失败，不静默回落。

若期望 `pguide config` 统一展示类型、帮助、默认值或完成扩展级 validate，可另行设计声明式配置描述的发现机制，例如伴随文件或命令元数据；尚未选择机制，不虚构已有协议字段，也不要求通用配置编辑为了每个未知 key 自动执行外部子命令。当前 pguide-command-v1 仅声明命令元数据，新增描述能力需单独定义兼容边界。

本项已纳入构想边界与实施种子的可验证要求；具体 namespace、typed value、描述发现、未知 key 诊断与配置文件语法仍为后续设计，未实施主配置或扩展协议变更。

### C-05：比较 VS Code settings 风格（建议采用，尚未定案）

用户提出用 VS Code settings 风格替代 Git 风格，并明确作用域先做用户级和项目级。已核对 VS Code 官方文档：settings.json 使用 JSON with Comments（JSONC），并非 YAML；扩展通过 `contributes.configuration` 描述唯一配置 ID、类型、默认值和说明，由宿主组合成配置体验。可扩展性来自这种声明/注册机制，不是 JSONC 解析器自身提供。

Agent 建议采用 JSONC + 顶层命名空间 key + 原生 JSON 值，例如：

```jsonc
{
  // key 是完整 ID，不是一个隐含的多层对象路径
  "core.defaultAgent": "local",
  "reports.enabled": true,
  "regulate.quota": {
    "timeoutMs": 300000,
    "maxAgentRuns": 10,
    "maxStallRuns": 3
  },
  "deploy.target": "staging"
}
```

相比 Git 分段语法，JSONC 可直接表达字符串、布尔值、数值、数组和复杂对象，无需自行设计重复 key、多值和嵌套对象语法。建议先仅支持一种主配置文件格式，不同时增加 YAML、INI 和 TOML；agents.yaml 仍作为独立资源保留，不因主配置选择 JSONC 就重新混回设置文件。以上具体 key 与文件名仅是候选，旧配置示例保持原始快照。

建议每个扩展声明自身 namespace 的配置描述，由配置基础设施统一支持来源、读写、默认值、提示和结构校验；描述如何发现尚需单独规范，不能声称 VS Code 的扩展 API 已能被本 CLI 直接使用。未知或未安装扩展的 key 可保留，但不宣称已经完成语义验证；不为了普通 get/set 自动执行任意扩展。

这能更自然地解决扩展配置归属及复杂值表达，但不能自动决定覆盖/合并和授权语义。VS Code 对标量和数组覆盖，对对象合并；不建议把这整套规则机械复制到治理工具。这里建议初期 project > user，按完整 setting key 覆盖、数组整体替换；普通对象是否按 key 整体替换待确认。Agent profile 与权限策略尤其不做隐式深合并或授权并集，保留显式校验与信任边界。

官方依据：

- [Settings](https://code.visualstudio.com/docs/configure/settings)：用户/工作区与覆盖规则。
- [JSON with Comments](https://code.visualstudio.com/docs/languages/json#_json-with-comments)：JSONC 与注释支持。
- [contributes.configuration](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration)：扩展配置描述。

官网抓取因网络解析限制不可用时，本次通过官方 microsoft/vscode-docs GitHub 仓库对应文档核对以上事实。JSONC 是否作为最终格式、具体 namespace、配置描述发现及对象合并规则均未因本次比较自动定案。
