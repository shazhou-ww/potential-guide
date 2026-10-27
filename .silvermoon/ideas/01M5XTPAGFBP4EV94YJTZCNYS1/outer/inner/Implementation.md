# Implementation

实现采用私有 workspace `packages/test-tree`，不发布 npm 包。保持已接受的
`idealRevision=3f01c34df2dd0473a2bb4e500ca9f56e5756c3ce` 及其理想世界文件不变。
接口、使用方式见 [工具说明](../../../../../packages/test-tree/README.md)，
验证结果见 [实施证据](./Evidence.md)。
后续 HTML 命令可移植性反馈及验证见 [命令修订证据](./Portable-manual-evidence.md)。
后续“人工操作不依赖测试框架、页面按状态展示”的纠偏见 [状态手册修正](./State-manual-evidence.md)；
该文取代前文证据中已过时的手册包装器方案，历史证据仍保留。

## Steps

### I-S01: 定义 state/transition 数据与绑定契约

以固定 YAML 表达状态树、探针及人工说明，只指定一个相对于 YAML 的 Binding TS 文件。
依据 state/检查 ID 推导固定的函数导出名，不维护 use 字段或手写注册表。
transition 调用完成进入操作并返回 after；约定部分初始化由该函数自行收尾，
已完成的转移由执行适配逆序释放，清理失败不阻断其他释放或掩盖原始错误。
执行入口按约定加载函数导出，不从 YAML 求值代码；after 由 transition 返回而非单独导出绑定。
`src/model.ts` 严格校验 YAML（包括重复键、非法字段、说明、ID、平台及单个相对 TS 路径），
`src/runner.ts` 提供每检查独立 context 的路径执行与 Node Test 注册。
测试入口显式提供模块加载器，只接收 YAML 解析出的 Binding TS 绝对文件名，
使动态测试导入留在测试边界而非生产静态依赖边界；不引入第二份路径或导出注册表。

### I-S02: 从同一 YAML 展开测试并生成文档

提供 Node Test 适配与终端树、Markdown、静态 HTML 输出。
测试可运行时展开或生成只读代码，不另维护手写 BDD 树。
文档消费者只读取数据，不导入 Binding TS 或业务实现。
区分结构/说明校验与执行绑定校验，明确报告无效字段、重复身份和缺失约定函数导出。
自动化仍按路径执行；人工输出按 state 分组，不按每个检查重复整条测试路径。
每个状态展示如何进入、在此状态观察、可以转向的状态和实际结束操作。
采用运行时展开而非生成测试源码。`src/cli.ts` 只依赖 model/render，
提供 tree/markdown/html 三种输出；写文件要求目标尚不存在，拒绝覆盖 YAML 或绑定。
HTML 使用原生折叠状态树、稳定锚点、全文转义和 CSP，无脚本或网络资源。
代码围栏显示为可复制的代码块；页面不展示绑定函数名或 before/after/it 标题。
所有输出明确标记 Not run；文档结构有效不等于导出有效或自动测试通过。
人工命令采用独立 Node 控制台中的原始公开 API 与 HTTP，不依赖 shell 专属语法。
明确 Node .editor 整块执行及等待提示符的用法；不将含 await 的行一次送入 node -i。
历史消费快照保留，不冒充更新后的页面。

### I-S03: 以 Check Host 接通代表性路径

将已有或后续同步的 Check Host E2E 迁入 YAML 状态树及约定命名的 Binding TS 导出，
补齐启动、执行、取消清理及故障恢复的人工说明。沿用隔离环境与自有资源清理约束；
本 Idea 不顺带提交或重做其他工作分支中的 E2E 改动。
新增一份 `test/check-host/host.states.yaml` 及一个 `host.binding.ts`，接入真实
CheckKernel、鉴权 HTTP、worker、执行及清理文件屏障，覆盖 ready/running/
cancelling/cancelled 和独立 faulted/recovered 分支。旧有 CLI 竞争测试保持不变。
删除容易与原始命令混淆的手册专用 manual.ts 包装器。
说明直接准备透明的业务 worker，调用公开 CheckKernel/serve/CheckClient/fetch，
演示状态进入、观察、屏障释放及已确认关闭后的目录删除，不导入测试绑定/helper。
明确该手动路径覆盖内核/HTTP/worker，不声称验证 discovery daemon 启动。
提交同源 Markdown/HTML 派生产物，并用测试验证它们与 YAML 完全一致；
纳入 pnpm catalog、package-layers、package-owned objectives 和 Turbo 输入。

## Acceptance criteria

### I-AC01: 转移与释放语义正确

用最小树证明每次测试独立进入路径、逆序调用已返回的 after，
探针失败不自动阻断兄弟路径，转移失败阻止本次后续进入。
注入返回前失败及 after 失败，证明部分资源和祖先资源均被处理，
原始错误与清理错误同时保留。
证明方式：`test/tree.test.ts` 的独立路径、部分初始化、探针与多个清理错误、
无效 after、真实 Node 子进程兄弟独立运行与平台跳过用例。

### I-AC02: 输出同源且文档错误明确可见

用固定 YAML 与故障输入验证自动测试及三种文档输出的节点、顺序和稳定标识一致，
Markdown 命令块保留格式，HTML 不执行说明中的脚本。
无效数据、缺失或非函数导出明确报错；transition 未返回有效 after 时报告契约错误，
不以空操作兜底。文档入口不加载实现且不创建 fixture 或启动进程。
证明方式：严格数据故障输入、缺失/非函数导出、不同 cwd 解析、抛错绑定的三种
文档 CLI 输出、覆盖拒绝、输出顺序、HTML 转义/CSP/无外部资源及派生产物一致性测试。

### I-AC03: Check Host 自动化与路径手册一致

运行接入后的代表性 E2E 路径和仓库既有相关检查；核对生成手册的前置操作、
探针及清理与 YAML 的进入及释放顺序一致，命令和检查说明足以独立操作。
故障注入后的预期故障状态不被写成测试失败，平台不适用项明确标注。
恢复探针验证新任务成功的同时，确认原故障任务仍为 Failed 且保留原始执行异常，
不得将执行异常混称为业务结果不通过，也不得重放或改写旧任务。
证明方式：六个 YAML 注册的真实 Host 检查和独立 Node 进程直接执行的文档代码块，
不导入测试绑定/helper；验证各状态快照、清理标记、故障恢复及目录释放。
另外核对输出为状态视图而非测试路径、代码不调用测试工具，实际验证 Node REPL 分块执行。
运行包内测试、仓库测试类型检查、相关 package-owned 集成及 `pnpm check`，
将既有失败或环境诊断与本次引入的问题分开记录，不以重跑掩盖失败。
