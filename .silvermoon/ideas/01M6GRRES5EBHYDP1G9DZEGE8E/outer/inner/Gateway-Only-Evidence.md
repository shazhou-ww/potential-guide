# Gateway-only 实施证据

## 范围与环境

基线为 `2d4185605cb373d9748dc510363022e935bc1bd6`，Windows、Node.js
`v24.11.1`、pnpm `11.22.0`。本文件只证明本次 Inner 候选；旧
[Gateway-Evidence.md](Gateway-Evidence.md) 的双 transport 结论不是本次证明。
Ideal、events、Deployment 种子和其他 Idea 的历史材料未修改；不执行 Outer、
不记录门禁事件、不 push、不发布 npm。测试目录、SQLite、用户设置和监听均为本次隔离夹具。

## 实现与调用方调查

- 服务仅导入并创建 `createIpfsGatewayClient`。删除服务 RPC/transport 字段、
  CLI 选项、完整 setting ID、生成校验器和默认节点；Gateway URL 必须由启用来源显式提供。
- 文件、用户 JSONC 和 CLI 在覆盖前校验。旧字段不论值是否合法都明确拒绝并提示
  `--ipfs-gateway-url`；不改写配置。用户服务字段先用当前服务契约检查，再调用既有
  shared loader 检查共享结构和注册表，防止旧注册描述或内存中的 catalog 把退役字段
  变成漏检。只使用用户文件显式字段，不把 schema 默认值当作来源；不改通用设置语义。
  冲突/损坏注册表仍失败，独立服务禁用用户层时不调用该 loader。
- 两入口保留 `--cwd`、四层覆盖、来源路径、完整对象替换、禁用用户主文件和
  项目服务值排除。没有公共 Gateway 默认值、RPC 探测、选择分支或回退。
- 未修改 raw-block reader、CID/UnixFS/DAG 校验及流、超时/取消预算。
  Engine/UI、本机访问策略和 owned lifecycle 沿用原实现；程序化 `IpfsClient` 注入不变。
- 当前 CLI consumer `scripts/check-task-service-consumer.mjs` 已移除旧 flags，
  增加两入口 × 用户/文件/CLI/禁用用户层的真实 Bundle 执行，并验证安装包 settings。
- 调查 `createIpfsClient` 及服务入口引用后，迁移仍默认 RPC 的
  `echo-config.mjs`、`check-in-process.mjs` 与对应文档：程序化示例改用显式
  `IPFS_GATEWAY` 或原有 client 注入，不将该环境变量加入声明式 CLI。
  相关 packed 场景显式安装 `ipfs-content`，不依赖传递依赖提升。
  `scripts/verify-task-ipfs.mjs` 的运行端改为 Gateway，作者导入、写块和 pin 仍使用 RPC。
  该需要外部 Kubo 的人工脚本本次仅做语法检查，不宣称实际外部执行。
- 作者 `build-bundles.mjs`、SDK `/publish`、`pguide task-bundle publish` 和 RPC helper/
  依赖保留；程序化 API 仍允许调用方注入读取 client。历史 Silvermoon 验证脚本不改写。

## 命令与结果

所有命令均在本工作树执行；未执行仓库依赖安装，manifest 与 lockfile 无变更。
packed harness 仅在自行生成依赖清单的隔离 consumer 中安装本地 tarball。

| 命令 | 本次结果 |
| --- | --- |
| `node scripts\build-settings.mjs` | 退出 0；删除 setting 描述后重新生成共享静态 catalog/validator。 |
| `pnpm exec turbo run build typecheck --filter=@potential-guide/pguide-task-engine --filter=pguide` | 退出 0；50/50 tasks 成功，28 cached。 |
| `pnpm exec tsx --test apps\pguide-task-engine\test\*.test.ts` | 首轮退出 0，5/5。 |
| `pnpm exec turbo run test --filter=@potential-guide/pguide-task-engine --filter=@potential-guide/ipfs-content --filter=@potential-guide/task-sdk --filter=@potential-guide/task-engine-server` | 退出 0；17/17 tasks，15 cached。服务 5/5、IPFS 5/5、SDK 15/15、Server API 15/15；缓存结果与实际重跑结果区分见下文。 |
| 同一条 targeted Turbo 命令追加 `--force` | 退出 0；17/17 tasks、0 cached，40/40 测试实际重跑通过（服务 5、IPFS 5、SDK 15、Server 15）。 |
| `node scripts\check-packages.mjs --task-service` | 修复本机陈旧构建输出后退出 0；4 selected / 22 internal packages，两个入口 × 4 种来源情形均经 Gateway 执行 Bundle，结果为 `{text:"packed"}`。 |
| 最终再次 `node scripts\check-packages.mjs --task-service` | 退出 0；5 selected / 22 internal packages。新增的已安装 settings 无退役 ID、作者 root pin、程序化 helper 缺 URL 拒绝/读取注入/显式 Gateway 读取断言均通过；8 个真实服务场景仍成功，Engine/UI assets、访问拒绝和 owned 退出清理通过。 |
| `pnpm exec biome format --write apps\pguide-task-engine scripts\check-task-service-consumer.mjs scripts\check-package-consumers.mjs scripts\verify-task-ipfs.mjs examples\task-server\echo-config.mjs examples\task-server\check-in-process.mjs` | 退出 0。 |
| `node --check examples\task-server\check-in-process.mjs` / `node --check scripts\verify-task-ipfs.mjs` | 均退出 0。 |
| `git diff --check` | 退出 0。 |
| `silvermoon check --worktree --audience agent` / `silvermoon check --staged --audience agent` | 均退出 0；仅暂存本次预期的 21 个文件，没有追加 Submit/Accept 或同步主线。 |

### 测试所证明的行为

- 配置测试：无 URL 明确失败；用户、文件与 CLI 优先级、路径、完整对象覆盖；
  启用用户/文件的两种旧字段覆盖 `"rpc"`、`"gateway"`、`"auto"`、URL、空串、
  null、false、数值、对象，即使有合法高层 Gateway URL 仍拒绝。旧 flag 的等号形式、
  分开形式及缺值均收到迁移提示。旧注册描述冲突不会掩盖退役输入；其他注册损坏仍失败。
- 进程测试：真实独立 binary 和顶层 pguide 均验证旧字段的原合法值和非法值、缺 URL、
  非法 Gateway URL、旧 flag、禁用损坏用户文件、项目排除；失败无 ready、无默认 DB。
- 服务测试：缺 URL 在指定 DB/监听副作用前失败；拒绝程序化服务旧字段。
  无 RPC 的标准 HTTP raw Gateway 执行 Bundle，Engine-only 与 UI HTTP 均成功；
  失败不回退，服务退出不停止来源。原有本机跨站拒绝、UI 回滚、幂等关闭与已有监听所有权保持。
- 作者回归：实际 RPC helper 可导入/读取夹具；作者 SDK 构建、锁定 Schema、导入与
  root pin 断言保持；`importTaskBundle` 仍经 `publishContent` 调用夹具的 `block.put`
  和 `pin.add`。未宣称连接真实 Kubo 做写入或远端 pin。
- IPFS 回归覆盖 base path、逐块 CID、DAG/文件/总保护预算、status/MIME/encoding、
  声明和流式超限、redirect、超时及取消；Server 回归覆盖程序化导入无副作用、授权、
  HTTP/SSE、恢复与资源所有权。

### 已观察的运行问题与恢复

1. 从仓库根把多个 package 测试直接拼给 `tsx --test`，本次明确得到 28/30；
   Server 的子进程导入和 SDK 的构建夹具无法从根目录解析 workspace 包。
   这是本次选择了错误测试 CWD，不作为产品基线失败；随后改用现有 workspace/Turbo
   runner；初轮包含缓存重放，随后追加 `--force` 实际重跑，40 项回归全部通过。
2. 初次 packed 验证发现本机 `task-engine-server/dist/main.js` 陈旧输出。
   `pnpm --filter @potential-guide/task-engine-server clean` 被 pnpm 解析成自身命令而失败；
   改用 `run clean`。单独 `run build` 不足以让已有 tsbuildinfo 补回已删除输出，
   并发 Turbo 还可能恢复旧缓存。因此在其他构建结束后，执行：

   ```powershell
   pnpm --filter @potential-guide/task-engine-server run clean
   pnpm exec tsc -b packages\task-engine-server --force
   pnpm exec turbo run build --filter=@potential-guide/task-engine-server --force
   node scripts\check-packages.mjs --task-service
   ```

   强制重发射并更新构建缓存后 packed 验证退出 0；不以缓存故障修改无关源码或清理其他用户数据。
   后续全库 Turbo 构建仍从另一输入 hash 的旧缓存恢复 `dist/main.*`；
   在所有构建结束后只移除这四个已无对应源码的生成文件，再执行 packed 检查。
3. 额外尝试 `node scripts\check-packages.mjs` 的全量 packed 消费，退出 1：
   独立 Bundle author 的 `node_modules` 重命名为 `author_modules` 时 Windows 返回
   `EPERM`（`scripts/check-task-bundle-consumer.mjs:183`），尚未进入后续 service
   场景。该结果不算全量 packed 成功，也不推断成历史产品缺陷；本次所需 service/helper
   消费用限定 `--task-service` 单独验证。
4. 增加复制后的程序化 helper 检查后，首次限定 packed 复跑因 consumer 缺少直接
   `@potential-guide/task-protocol` 依赖而退出 1。该依赖原本由 helper 直接导入，
   新增夹具不能依赖传递依赖提升；已修正该隔离 consumer 的生成清单，并在示例文档
   明确列出直接依赖。此项是本次测试装配缺陷，不标记为历史基线。

## 全库检查与基线对照

首轮 `pnpm check` 退出 1：build/layers、format、lint、typecheck 已通过，进入
Turbo test 后在 `@potential-guide/objective-monorepo-standard` 的
`real repository has thirty-seven package-owned subjects and no old contract input`
失败。观测为 `.agent/skills/component-responsibility-docs/SKILL.md` 的
`file-classification` 状态 `unverified`，测试期望 `pass`；66/74 tasks 成功，
59 cached。因此没有执行该串联命令后面的完整 `pack:check`，不宣称全库全绿。
最终源码再次执行 `pnpm check` 仍退出 1，唯一报告失败 task 为同一个
`@potential-guide/objective-monorepo-standard#test`，同一路径与 `unverified`
断言；69/74 tasks 成功、66 cached，Turbo 用时 `2m1.849s`。其前置四项仍通过，
没有把未运行的后续完整 pack 阶段算作成功。
修正上述 consumer 直接依赖后再次运行 `pnpm check`：退出 1，仍仅报告相同分类断言；
69/74 tasks 成功、69 cached，`27.977s`，build/layers、format、lint、typecheck 均通过。

不是沿用旧证据判断基线：本次将准确 HEAD 导出到工作树 `.cache`，用当前同一
`checkRepository(subject, 1)` 对原始快照重新观察，断言得到同一路径、规则和
`unverified`。命令与输入为：

```powershell
git archive --format=zip --output=.cache\gateway-baseline.zip HEAD
Expand-Archive -Path .cache\gateway-baseline.zip -DestinationPath .cache\gateway-baseline -Force
```

随后 `node --input-type=module` 执行以下实际检查，退出 0：

```js
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
const {parseObjectives,projectObjective}=await import(pathToFileURL(resolve("packages","objective-pilot","dist","index.js")).href);
const {checkRepository}=await import(pathToFileURL(resolve("packages","objective-monorepo-standard","dist","index.js")).href);
const root=resolve(".cache","gateway-baseline");
const entry=parseObjectives(await readFile(join(root,"objectives.yaml"),"utf8")).standardize;
const subject=projectObjective(entry,{repo:{rootPath:root,origin:"https://example.test/target.git"},path:"."},undefined);
const result=await checkRepository(subject,1);
const finding=result.report.findings.find(item=>item.rule==="file-classification"&&item.location===".agent/skills/component-responsibility-docs/SKILL.md");
assert.equal(finding?.state,"unverified");
console.log(JSON.stringify({baseline:"2d4185605cb373d9748dc510363022e935bc1bd6",finding}));
```

输出的 `evidence` 为 `No responsibility rule covers this existing file; filename
alone is not a violation.`；归档和展开目录随后删除，未改动该技能或责任分类策略。
本次定向运行没有观测到 readiness timeout，不引用历史偶发失败替代当前结果。

提交前 snapshot check 使用的共享本地 `origin/main` tracking ref 已推进到
`a6067e7b9cf4a320cddae4a539f9ffb4d6b738da`；本 agent 没有 fetch、merge 或 push。
代码与归档基线仍为本节列出的初始 HEAD，父层负责后续并发集成、同步与审阅。
