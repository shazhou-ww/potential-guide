# 实施证据

本文只证明 [Implementation.md](./Implementation.md) 的主体世界结果，不代表阶段接受、Pinboard 发布或部署。理想世界、Deployment 契约及事件日志未修改；D-* 不勾选。

## I-S01：实际脚手架与迁移边界

使用当前仓库构建出的 CLI 实际执行：

```powershell
node packages\pguide-task-bundle\dist\bin.js init packages\check-sdk\.cache\init-template --format json
node packages\pguide-task-bundle\dist\bin.js build packages\check-sdk\.cache\init-template\task.build.yaml --format json
```

两条命令均退出 0。init 复用 check-sdk 的包，未新增依赖或更改脚本，生成 `.gitignore`、标准 Task Build YAML、TypeBox 契约、显式 `runTask` 入口。原始 Echo 模板构建 CID 为 `bafybeicjmsyldc7uvbwrmyncu52yaaacxqafipmcheryjin6vdiovp6mpq`；该检查用目录已清理，不是交付制品。

保留环境检查的一个源码包与三个独立执行制品，库根导出未删改。通用 Task SDK、Engine 和 Task Bundle 编译器未加入 Check 规则。

## I-S02 / I-AC01：唯一声明、固定输入、候选接受

- 新包 `packages/check-sdk` 的根入口只包含纯结果组装与回调，`contracts` 导出 TypeBox 工厂和派生类型，`authoring` 导出独立 Check YAML Schema、第一阶段准备、Reference frontmatter 校验及实际 CAR 资源核对。
- 环境检查三份 `*.check.build.yaml` 是问题码的唯一作者来源。第一阶段生成 `dist/definitions/<kind>.{js,d.ts}` 的冻结代码表及字面量类型，业务实现、结果 Schema、运行时允许码和文档覆盖矩阵共享它；未知运行时问题码抛出异常。
- `prepare.mjs` 完成三份声明校验与输入快照；`typecheck` 也先准备生成类型，`clean` 同时删除包输出与增量构建信息。`build.mjs` 用标准 `buildTask` API 消费 `dist/staging/<kind>/task.build.yaml`，不调用低层编译接口，不另实现编译器。
- 第一阶段复制源码、生成契约依赖、逐页精确选择资源与 `resources/check.json`；第二阶段使用这些固定业务输入。测试在准备后破坏作者源码和 Reference，仍从快照构建并交付原始字节。
- 接受前读取真实 CAR 与目录，比较 CID、资源全集及逐文件字节；全部三个候选均通过后才替换 `dist/bundles` 及索引。负例证明第一阶段文档失败、第二阶段拒绝 TypeBox Date，以及 include 漏选均不改写已接受 CAR/索引。
- 单语言、多语言、零问题码构建通过。缺定义页、缺问题页、命名不符、未知语言（包括空目录）/问题码、重复声明、越界路径、缺失/非法 frontmatter、字段类型错误和未知字段均拒绝。frontmatter 仅允许必填非空 title、description，description 最多 200 个 Unicode code points。
- 合法 frontmatter 后的空正文、任意章节、坏正文链接和 reference-style links 均不是门禁；构建不解析正文或正文引用图。

最终交付索引为 `packages/check-environment/dist/bundles/references.json`，形状保持 `{tools,directories,network}`，每项仅有相对 `directory`、`car` 与 `cid`：

| 检查 | CAR（相对包目录） | CID |
| --- | --- | --- |
| tools | `dist/bundles/tools.car` | `bafybeieqcbsrb4xfnstoc5fmlhhjefyylpgruk4nfgk36kcuxf2mj6xota` |
| directories | `dist/bundles/directories.car` | `bafybeihyo3ujmjh7jgtlfwmi6inowbcub4xdi2amj2m23rbv7ik3mzhdbi` |
| network | `dist/bundles/network.car` | `bafybeigpnzao2lgpmx2ajfdu4w6uzzd3ovo7rf6gfrdv4dyuwwwepr6oca` |

对应目录为 `dist/bundles/<kind>/`；其中含标准 task.yaml、worker.cjs、schemas、resources/check.json 和仅属于该检查的 `resources/references/en/check.md` 与问题页。资源以原文精确字节进入 CAR，可通过实际 CID 下的固定相对路径定位，不复制其他检查或共享 SDK 的文档。

## I-S03 / I-AC02 / I-AC03：行为、消费者、独立作者

`packages/check-sdk/test/sdk.test.ts` 与环境检查的 `authoring.test.ts`、`bundle.test.ts`、`checks.test.ts` 共 17 个顶层测试，最终定向运行全部通过（退出 0）：

```powershell
pnpm exec tsx --test packages\check-sdk\test\sdk.test.ts packages\check-environment\test\*.test.ts
```

证明结果严格性、代码字面量约束、故障原对象传播、取消前后检查、Context/log 透传、业务 finally 清理、实际进程退出、目录探针删除、HTTP 超时与取消、三 CAR 的 Engine 通过/问题/故障/取消结果以及资源精确交付。既有工具、目录、DNS/HTTP 算法和预算未重写。

最小新检查位于 `packages/check-sdk/examples/text/`，入口为 `src/main.ts`，契约为 `src/contract.ts`，声明为 `text.check.build.yaml`，执行 `node build.mjs` 即完成准备、标准构建和 CAR 验证；它仅依赖公开包，可复制到独立目录并安装 packed 依赖。输出为该独立示例自身的 `dist/staging/text/bundle.car`，不读取环境检查源码。测试实际对生成后的示例调用 TypeScript 检查，并经 Engine 执行非空文本与空白文本两种输入。

根入口的 esbuild 依赖闭包只有 index 与纯代码定义校验器；运行时导入无 TypeBox、YAML、文件扫描或 authoring 模块。环境与新检查的真实 worker.cjs 均验证不包含作者校验或 Schema 构建代码。公共 Reference 随 check-sdk 打包，采用同一 frontmatter 门禁。

SDK 自身构建只预备独立示例的作者输入和生成类型，不编译自己的 Bundle；Turbo 显式跟踪该示例自己的 `examples/text/dist/`。`npm pack --dry-run --json --ignore-scripts` 实际清单为 29 个文件，含两篇公共 Reference 及示例源码/声明/构建脚本，不含示例生成的 dist。新增 SDK 同时纳入本地 verificationPackages 与依赖闭包测试，但没有增加发布标签或 npm 发布路由。

环境 npm 打包白名单只交付库、生成定义、Task 模块和已接受 bundles，不打入 staging/candidate。结构校验保留原来的陈旧输出检测，并显式要求六个从 Check YAML 生成的 JS/声明文件存在，不把它们误认成缺少 src 对应文件的陈旧 tsc 输出。完整结构打包验证退出 0：SDK 29 个文件，环境检查 99 个文件。

仓库集成补齐 package-layers、根/包 objectives 声明和 TypeScript/Turbo 输出；真实 Objective 消费者测试现覆盖 38 个包自有 subject，定向运行 3/3 通过。第一次全量运行曾因现有 Engine 并发启动超时失败；未改 Engine，其五个相关文件限制并发后 35/35 通过。新增包暴露的 subject 声明/数量断言已修复，而非跳过测试。

最终完整 `pnpm check` 退出 0，包含源码一致性、层级、格式、lint、类型、全部测试与结构打包验证。相关套件为 Check SDK 7/7、环境检查 10/10、Task Engine 199/199、monorepo Objective 62/62，根 scripts 测试 63/63；没有新增跳过项。完整输出保留在工作区 `.cache/check-sdk-pnpm-check.log`，不是交付资源。此前的 Engine 并发启动超时在最终完整运行中也不再出现，未更改通用 Engine 的实现或断言。

`git diff --check` 退出 0；`silvermoon check --worktree --audience agent` 退出 0，snapshot 为 valid。基线为本地 origin/main 跟踪引用 `35393dcb2b75f2a57d2865ac600e568d32fbb141`，未据此声称候选已同步。所有 I-* 的实施与证据已完成；D-* 保持未完成，候选仍未提交，交由上级独立审阅、同步与阶段决定。无已知实施阻塞；这些检查不等同于部署或 npm 发布。

## 监督者独立复验

监督者依据用户明确授予的阶段门禁审批权限，直接审阅共享 SDK、两阶段构建与接受路径、环境检查的行为差异、声明/打包/依赖分层接线和测试，不由实施者自批。独立重跑上述四个测试文件，17/17 通过，无跳过或取消；复核最终完整 `pnpm check` 的打包结束输出以及成功结果。

另将 SDK、环境库、标准作者工具和 Engine 的依赖闭包实际打包，在仓库之外建立独立 pnpm 消费工程，内部依赖全部指向本次 tarball。只从安装后的 SDK 复制 text 作者示例并构建，得到 CID `bafybeicldl4w2juh77ex3adu5hbxebljdnvt6te2many2tgphlkf2uqtqu`；直接调用安装后的环境库检查当前 Node，结果严格为 `{pass:true}`。这些复验退出 0，不使用仓库内部源码路径作为消费者运行入口；尚不代替现实世界的 Pinboard 获取与独立 Engine 执行证据。审阅未发现阻塞性实施缺陷，允许在准确修订同步并提交后批准主体世界门禁。

首次提交时发现新 Reference 工作树仍为 CRLF，而仓库既有 `.gitattributes` 规定 LF，导致初次 CAR 不能代表提交后的准确文档字节。监督者将本次 Reference 工作树统一为已提交的 LF 字节，重建全部制品、重打包并重装两个业务包，再构建独立作者示例；上述 CID 均为修正后的最终值。四个定向测试文件再次 17/17 通过。该修正不改变 Git 中的文档内容或通用构建规则，避免把换行差异作为新协议或自动文档转换逻辑。
