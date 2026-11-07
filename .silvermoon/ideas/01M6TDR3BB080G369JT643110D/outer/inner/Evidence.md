# 实现证据

## 契约与执行链

- `packages/check-sdk/src/contracts.ts`：两个结果变体及每个问题均要求全部声明语言，拒绝缺失、额外语言、正文、错误语言路径和错误节点页面类型；通过结果仍无 `problems`。
- `packages/check-sdk/src/authoring.ts`：复用已有严格 Reference 映射、frontmatter、覆盖及 CAR 字节验证，仅扩展 YAML 派生定义中的冻结 `languages`。
- `packages/task-sdk/src/index.ts`：现有受信 `workerData.bundle.cid` 来自 Engine 的已验证根和 ready 握手；冻结的 `context.bundle` 只新增只读 CID，不读取业务 input 中的身份。
- `packages/check-sdk/src/index.ts`：统一执行身份校验与 CIDv1 规范化，构造完整 `ipfs://` URI。无最终 CID 的构建自引用；不读取 Markdown，不修改结论，不引入 Engine 问题代码解释。
- 三个环境 Bundle 及独立 text 示例同时导入生成的语言和代码定义，契约与执行适配器一致升级。环境库直接调用需要显式已验证身份；旧 Objective 只消费未变的版本及写探针辅助接口。

## 针对性证明

`pnpm --filter @potential-guide/check-sdk --filter @potential-guide/check-environment test`：
SDK 9 项、环境 10 项通过。`pnpm --filter @potential-guide/task-sdk test`：
1 项通过。`pnpm exec tsc -p tsconfig.test.json --pretty false` 通过。
`pnpm pack:check` 通过。

SDK 的独立脚手架集成用例实际经标准构建、CAR 校验、IPFS 内存导入和通用 Engine
执行：`en`/`zh-CN`，通过及两个问题，两个不同文档版本、不同最终 CID。仅修改检查及问题
文档时 Worker 字节保持一致，证明最终 CID 不嵌入 Worker。只传递分离节点，
按 URI 的根和路径读取发布资源，不查询 code 索引；旧结果仍读取旧文本。模拟发布资源不可用
及不支持语言时显式拒绝，原结果保持逐值不变。此用例是实现证明，不冒充真实部署验收。

三个环境 CAR 的通过、未通过、多问题、执行超时、输出超限、取消及物理释放回归通过；
资源选择/字节不符拒绝，构建失败保留已接受输出。

## 全量验证环境

原 Windows 工作树已执行 `pnpm check`：构建、分层、格式、lint、类型检查通过，随后已有
`pguide-task-bundle` 文件符号链接测试因宿主缺少权限报 `EPERM`。这些用例和实现均未改动。
补充运行其余工作区测试时，已有服务 CLI 测试发现宿主全局 `pguide-task-engine.CMD`
与测试 fixture 命令重名，明确报 command ambiguity；不删除或修改用户的全局命令。

为获得完整结果，将当前候选的全部受 Git 跟踪文件复制至仓库自有 `.validation-check-documentation`，
通过 WSL Ubuntu 使用独立依赖和 Git 仓库运行原样 `pnpm check`。清理继承的 Windows PATH，
将 `TMPDIR` 及 pnpm store 指向该隔离副本的 `.cache`，不改动共享系统配置。
首次将副本放在 `.cache` 时，Biome 按仓库排除规则忽略整个副本；移到上述专属目录后，
恢复其独立依赖再执行原样检查；挂载盘限制及最终通过结果见下文。

WSL 的 Windows 挂载盘也不能满足已有 POSIX 私有目录权限测试，明确报 `EPRIVATE`，
因此不放宽安全校验、不跳过用例，而进一步将候选复制为当前用户原生 Linux 文件系统上的
独立 Git 验证项目。该项目内的 `.cache` 承担所有测试临时输入，继承的 Windows PATH
仍被隔离。复制后 pnpm 按当前路径恢复依赖元数据；未关闭构建、lint、类型检查或任何测试。
原生验证工作区中 `source` 是候选 Git 仓库，旁边的 `.cache` 是独立运行目录，
从而满足既有消费者隔离测试的要求：运行根必须在作者仓库及其依赖祖先树之外。
所有输入仍在专属验证项目内，不使用系统临时目录，也不修改隔离或私有文件安全断言。

最终在原生隔离项目的 `source` 中执行 `pnpm check`，退出 **0**：
来源检查、构建/分层、格式、lint、工作区与测试类型检查、全部工作区测试、
76 项脚本测试及打包结构检查全部通过；测试图为 **70 successful, 70 total**，
脚本为 **76 pass, 0 fail**。环境仅设置 `CI=true`、项目自有外部运行目录 `TMPDIR`，
并隔离继承的 Windows PATH；没有测试排除项或源码修补。
对当前工作树的 **28 个已修改 package 文件** 与通过检查的原生候选逐文件计算 SHA-256，
全部字节一致（包括源代码、测试及直接相关 README）。
原生及挂载盘验证副本在取回日志后删除，不作为仓库交付物。

补充命令：

- `node scripts/build.mjs --filter=@potential-guide/check-environment...`：8 个构建任务及独立资源验收通过。
- `git diff --check`：通过。
- `silvermoon check --worktree --audience agent`：当前候选通过；正式提交前另执行 index 检查。

首次构建因缺少 `cross-spawn` 失败后才恢复依赖；默认共享 pnpm store 报 SQLite 损坏，
因此使用仓库自有 `.cache/pnpm-store`，不修复或删除共享 store。

## 后续独立消费建议

以下只提供父代理部署验证配方，不记录部署完成或任何 `accept*`：

1. 在隔离调用目录安装本修订打包出的 `task-engine` 等运行依赖，使用标准作者流水线构建并
   导入/固定真实 CAR；三个环境包取 `dist/bundles/references.json` 的根，提交通过及未通过输入，
   等待完成和物理释放，保存真实结果。
2. 另复制 text 示例作为独立作者包。在 YAML 增加 `zh-CN` 及完整翻译 Reference 映射，
   通过 `prepareCheck`、`buildTask`、`verifyCheckResources` 构建 A。修改一份文档后构建 B，
   证明两根不同，分别保留并固定两份 CAR；无需作者填写任何 CID 或逐检查 URI。
3. 调用方仅接收 `structuredClone(result)` 或 `structuredClone(problem)`。遍历该节点
   `documentation` 的声明语言；将每个完整 `ipfs://<CID>/<path>` 交给真实 IPFS 客户端，
   或将协议替换为受控网关的 `/ipfs/<CID>/<path>`，检查返回正文。不得读取
   `resources/check.json` 或按问题 code 拼 URI。用 `ipfs cat <完整 URI>` 也可直接证明。
4. A/B 都执行通过与未通过输入；确认 A 的节点仍返回 A 文本，B 的节点返回 B 文本，
   每个问题及通过 result 都能独立查阅。记录完整根、输入、结果及每语言读取字节。
5. 对其中一个读取使用不可用网关或明确注入失败的文档读取客户端，保留显式错误；比较读取前后
   已保存结果完全相同。避免仅取消 pin 后读取，因为本地缓存可能仍可用。另验证不支持语言
   明确报错，不静默选其他语言。此读故障不得伪装成检查问题或执行失败。

无需 npm 发布或共享服务变更。真实调用、版本、语言及不可用证据应由父代理在 Outer World
单独记录，再进行部署验收。

若没有 Kubo/Docker，可在独立安装的消费包使用打包后的
`task-engine/testing` 的 `MemoryIpfsClient.import(artifact.files)` 导入真实 CAR，
通过 `ipfs-content` 的 `openContent` 逐块校验并解析 URI，而非在源工作区复跑测试。
消费者核心读取逻辑如下，`client` 可替换为真实网关客户端：

```js
import { openContent } from "@potential-guide/ipfs-content";

async function readDocumentation(node, language, client) {
  const reference = node.documentation[language];
  if (!reference) throw new Error(`Unsupported documentation language: ${language}`);
  const uri = new URL(reference);
  if (uri.protocol !== "ipfs:") throw new Error("Unsupported documentation URI");
  const entry = await openContent(client, `${uri.hostname}${uri.pathname}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (entry.type !== "file" && entry.type !== "raw") throw new Error("Not a document");
  const chunks = [];
  for await (const chunk of entry.content()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
```

不可用分支可传入独立的
`{block:{get:async()=>{throw new Error("Documentation unavailable")}}}`，
不影响 Engine 已保存的结果或实际 Bundle 的其他消费方。
