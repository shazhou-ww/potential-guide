# Check 分包结构草案

本文是 [实施契约](./Implementation.md) 的设计说明，尚未实现；不新增独立验收契约。

## 两个源码包，三个执行制品

| 包 | 定位 | 交付 |
| --- | --- | --- |
| `@potential-guide/check-sdk`（新增名称） | 新架构 Check 的公共作者库 | 可复用的类型、契约、回调适配及公共 Reference 文档，不生成自己的 Task Bundle |
| `@potential-guide/check-environment`（保留） | 工具版本、目录和网络检查 | 库 API，以及各自带有 Reference 文档的 tools、directories、network 三个独立 Task Bundle |

不把环境检查拆成三个 npm 包。每个 Bundle 有独立输入契约、入口、CAR 和 CID，能单独提交给 Task Engine；源码与测试仍由一个环境检查包维护。这里的共享包面向 Task Engine 作者，不是旧 `check-task` 的改名。

## 新增 `check-sdk` 包

建议目录为 `packages/check-sdk/`，名称确定为 `@potential-guide/check-sdk`，本次不涉及 npm 名称可用性核验或发布。

包含三类职责：

1. **统一结果契约**：导出 `CheckProblem`、`CheckResult` 和对应 TypeBox Schema，类型从 Schema 推导；提供 `createCheckContract(inputSchema)`，组合业务输入、公共结果和不接受业务消息的契约。
2. **统一结果组装**：提供问题列表到结果的转换。空列表返回 `{pass:true}`；非空列表返回 `{pass:false,problems}`，不输出通过项。
3. **回调适配**：提供 `createCheckTask(check)`，将返回问题列表的业务函数转换为可传给 `runTask` 的回调，保留输入类型推导与 Task Context，执行前后检查取消。

公共 Reference 随共享包维护，供新检查作者引用；README 只做入口，不代替完整契约说明：

```text
packages/check-sdk/
  src/                     公共契约、结果组装和回调适配
  references/
    check-result.md        字段语义、通过/不通过示例和兼容规则
    check-callback.md      回调约定、执行故障、取消、日志与清理边界
  README.md                作者入口与 Reference 索引
```

这些是共享包的作者文档，不自动成为每个 Bundle 的资源；具体检查不得把自己的问题码解释放到共享包里。实施时确保共享包的打包清单包含这些文档，避免仓库中可读、包安装后缺失。

沿用现有结果，不另加外层包装：

```ts
type CheckProblem = { target: string; code: string; actual: string | null };
type CheckResult = { pass: true } | { pass: false; problems: CheckProblem[] };
```

上面是形状示意；实际 Schema 要求失败列表非空、通过结果不含 `problems`，拒绝额外字段，并保留现有字段约束。

拟议用法如下，API 尚未实现：

```ts
// contract.ts
export default createCheckContract(toolsInputSchema);

// main.ts
runTask(createCheckTask(inspectTools));
```

`inspectTools(input, context)` 只返回实际问题列表。现有 `checkTools` 库函数继续通过同一个公共结果组装函数返回 `CheckResult`，不能破坏 Objective 消费者。

**不包含**工具执行、目录探测、DNS/HTTP 算法，也不负责超时策略、子进程清理、调度、构建或 Pinboard 发布。执行异常继续抛出，取消继续传播，不能转为 `pass:false`；日志使用 `context.log`，具体资源由业务实现清理。`runTask` 仍由作者入口显式调用，不由共享包暗中启动。

依赖方向是环境检查 → Check SDK → 通用 Task SDK；Check SDK 的契约使用 TypeBox，不依赖环境检查、旧 Check 制品/Host 包或 Task Bundle 构建工具。纯契约与回调入口应分离，避免运行时代码因导入结果工具而携带作者侧 Schema 构建依赖。通用 Task SDK 不反向依赖 Check SDK。

## 环境检查包：当前结构

实际源码位于 [check-environment](../../../../../packages/check-environment/README.md)：

```text
packages/check-environment/
  build.mjs                 手写声明，调用低层 buildTaskBundle
  src/
    contracts.ts            三种输入和公共结果的 JSON Schema
    result.ts               公共结果类型、组装及环境检查辅助函数
    tools.ts                工具版本检查
    directories.ts          目录检查、写入探测
    network.ts              DNS 和 HTTP 检查
    command.ts              有界命令执行与清理
    index.ts                现有库导出
  test/
    checks.test.ts           库行为测试
    bundle.test.ts           三种 Bundle 的 Engine 集成测试
```

另有包声明、TypeScript 配置、README、许可证和 Objective 声明。当前输出为 `dist/bundles/<kind>/`、对应 CAR 及 `references.json`。

## 环境检查包：迁移后结构

建议使用包根内的三份标准构建配置；每份配置的源文件和输出都在其目录范围内，不让作者路径越过构建根：

```text
packages/check-environment/
  tools.task.build.yaml
  directories.task.build.yaml
  network.task.build.yaml
  references/
    tools/
      check.md              工具检查用途、输入、结果与环境前提
      problems/*.md         每个稳定问题码的解释
    directories/
      check.md
      problems/*.md
    network/
      check.md
      problems/*.md
  src/
    tasks/
      tools/{contract.ts,main.ts}
      directories/{contract.ts,main.ts}
      network/{contract.ts,main.ts}
    tools.ts
    directories.ts
    network.ts
    command.ts
    result.ts               仅保留环境专属辅助逻辑或兼容导出
    index.ts                保留现有库 API
  test/
    checks.test.ts
    bundle.test.ts
```

每份 `contract.ts` 定义各自输入并使用公共 Check 契约；`main.ts` 显式调用 `runTask(createCheckTask(...))`。原 `contracts.ts` 的公共结果定义移到 Check SDK，业务输入迁到各 Task 契约，测试跟随更新，避免维护两份 Schema。

先实际运行 `task-bundle init` 获取标准模板，再按上述多入口布局调整文件名和路径。三份配置均使用标准作者构建流程，例如：

```text
pguide task-bundle build tools.task.build.yaml
pguide task-bundle build directories.task.build.yaml
pguide task-bundle build network.task.build.yaml
```

配置分别输出到 `dist/bundles/tools`、`dist/bundles/directories`、`dist/bundles/network`，保留对应 CAR。现有 `build.mjs` 不再承担声明生成或低层编译；若仍需聚合构建与生成 `references.json`，仅保留薄编排，不复制构建规则。库的 TypeScript 编译仍保留。

共享包代码在作者构建时打入各 Worker，Engine 不安装这两个 npm 包。部署阶段用 `pinboard import` 发布三个 CAR，核对原 CID，并在独立消费环境验证执行；不是把源码目录作为执行制品上传。

## Reference 归属与随制品交付

Reference 是检查内容的一部分，不是某次执行的日志或结果，也不能只留在 npm README 中：

- **公共约定**由 Check SDK 的 `references/` 维护，解释结果与回调契约。
- **检查知识**由环境检查包各自的 `references/<kind>/` 维护。`check.md` 解释用途、输入与结果、适用前提和限制；`problems/<code>.md` 解释问题含义、`target`/`actual` 的语义、排查及建议处理方式，不执行修复。
- 工具检查覆盖 `tool-missing`、`tool-unusable`、`version-unparseable`、`tool-version`；目录检查覆盖 `not-directory`、`directory-unusable`；网络检查覆盖 `dns-unavailable`、`http-status`、`http-unavailable`。超时、启动或清理故障等仍按执行故障说明，不伪造新的业务问题码。

作者配置使用现有 `include` 机制交付文档，不恢复旧 Check manifest 的 `references` 字段。例如工具检查：

```yaml
include:
  - from: references/tools/**/*.md
    to: resources/references/
```

另外两份构建配置只选择自己的文档。按照标准构建器的静态前缀规则，工具 Bundle 的成品为：

```text
dist/bundles/tools/
  task.yaml
  worker.cjs
  schemas/                 构建器生成的契约
  resources/
    references/
      check.md
      problems/
        tool-missing.md
        tool-unusable.md
        version-unparseable.md
        tool-version.md
```

文档路径与问题码的对应先采用上述稳定约定：结合实际 Run 的 Bundle CID，通过 `ipfs://<CID>/resources/references/check.md` 和 `ipfs://<CID>/resources/references/problems/<code>.md` 读取。这里是 Check 层的交付约定，不是 Engine 自动解析或展示 Reference 的现成功能，也不增加结果字段。

文档和代码共同进入 CAR 的完整文件清单与根 CID，因此 Reference 内容修改也会产生新 CID。检查文档之间使用能在制品内解析的相对链接，不依赖作者 checkout 或浮动远程页面。

迁移测试除执行检查外，还应核对三个 CAR 各自包含说明页、所有可返回问题码均有对应页、相对链接可解析，且没有误打入其他检查的文档。Pinboard 独立消费验证应读取实际 CID 下的文档，不能仅证明源码目录里存在文件。
