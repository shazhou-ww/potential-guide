# Task Bundle 作者 CLI 设备切换交接

> 此文保留原检查点事实。2026-11-03 已恢复 Inner 实施；
> 新增改动、当前命令结果及限制以[实施验证](Verification.md)为准，
> 不能再把下文“未完成工作”全部当作当前状态。accepted Ideal 保持不变。

## 检查点状态

2026-11-03，用户要求停止扩展实现，保存当前阶段性检查点后换设备。
本次不是完成实施：不记录 `submitInner`、`acceptInner`，不开始外部部署。
`Implementation.md` 和 ledger 的 I/D 项仍未宣称全部完成。

- Idea：`01M6GWRMT65XKB6QZKPYE6JEXD`，alias `task-bundle-authoring-cli`。
- 已接受且本次未改动的 Ideal：
  `0595631ec62b8f949e611e98721b155c380f1e56`。
- 实施起点为 `8b841ea3de6359569627c05049502061bdfc76fa`；
  当时生命周期为 `implementing`、控制权 `downstream`，三个 gate 均为 `explicit`。
- 当时事件 digest 为 `966a666e8462913c2145fb141e78bcc3e30e227e`；
  此值仅为交接背景，恢复时必须刷新观察，不能拿它重放旧决定。
- 当前分支为 `agents/silvermoon-task-bundle-cli-setup`，primary 为 `origin/main`。
  检查点提交由正常 Git 同步；准确提交号及可达性见交付消息与 Git 历史。

父代理有用户明确授予的生命周期批准权限。实现代理不得自行 accept/waive；
完成实施以后仍需准确同步的 `submitInner` 和父代理审批，才能进入外部验证。

## 已落地但尚待完整验收的改动

### 作者包与命令

新增 `packages/pguide-task-bundle/`：

- `package.json`、`tsconfig.json`、`objectives.yaml`、`settings.json`，
  包名 `@potential-guide/pguide-task-bundle`，独立 binary `pguide-task-bundle`。
- `src/bin.ts` 复用 CLI Core 的 discovery metadata、全局参数、结构化 help、
  输出与配置；实现 `check author <file>`、`check artifact <directory>`、
  `build <file>`、`publish <directory> [--ipfs-rpc <url>]`，没有 include 命令。
- `src/authoring.ts` 实现构建描述验证、TypeBox 模块加载及 Schema 转换、
  文件选择、内存检查和 SDK 构建调用；类型 `BundleCallback<typeof contract>`
  从同源 TypeBox 定义推导 input/result/message。
- `examples/echo/` 是不手写运行 `task.yaml` 的新作者示例；README 记录实际字段、
  支持能力、路径/glob 语义及 trusted-code 边界。
- 构建描述机器 Schema 为 `schemas/artifacts/task-build/v1.json`，
  由 `scripts/sync-objective-schemas.mjs` 从源码同步。
- 作者 check/build 在可信本地进程求值 contract；artifact check/publish
  不求值作者模块。作者侧编译采用 esbuild，不代替作者项目的 TypeScript 类型检查。
- 当前 RPC 设置为 `task-bundle.ipfsRpc`，命令行优先；
  无默认节点、不修改全局设置、不启动服务。该键与同级服务 Idea 的设置分属命名空间。

TypeBox 选用 `@sinclair/typebox@0.34.52`，加入共享 catalog 并更新 lockfile。
尝试通过 npmx.dev 查询时遇到工具地址访问限制，搜索也无结果；
随后用包管理器读取发行包 metadata，并对实际安装的 Kind/Transform/Tuple/Never
表示做本地验证，没有凭示例假定语义。
当前支持 whitelist、Tuple 转 Draft 2020-12、Never、离线 shared schemas；
不支持的 kind/transform、format/content 约束和 Engine 不支持关键字明确拒绝。

### SDK、Bundle 与 Engine

- `packages/task-protocol/src/bundle.ts` 增加必填的精确 `include`，
  验证 portable 路径、大小写/父子冲突及完整文件集合；
  无清单的旧 Bundle 明确拒绝并提示重新构建、使用新 CID。
- `packages/task-engine/src/bundle.ts` 在装载时验证相同精确集合。
  `schemas/artifacts/task/v1.json` 和 Axis 文档同步更新，没有旧格式兼容回退。
- `packages/pguide-task-bundle/src/build.ts` 仅保留纯编译/构建（已从 Task SDK 迁出）：
  `compileTaskBundle` 产出内存快照，`buildTaskBundle` 生成声明、Worker、
  schemas/resources 和 UnixFS CID；低层声明输入 API 保留供仓库工具使用，
  它生成清单，不是旧成品装载兼容路径。
- 新增 `/artifact` 与 `/publish` 入口。发布校验并上传同一个字节快照，
  校验每块/root CID 后 pin；`/build` 不再暴露 RPC client/import 装配。
- 构建先验证完整候选，再用同级 staging/backup、独占锁和 ownership marker
  替换受管输出；拒绝未知输出目录、链接和选择冲突，重建不叠加残留。
  ownership marker 不在 Bundle 内；它不参与 CID。
- `IpfsImportClient` 移除未被发布使用的 `block.get` 继承要求，
  使 Kubo 原生发布 client 与只需 put/pin 的接口一致。
- 合法额外输入字段的 equality 语义已有实现；本次没有另加投影算法，
  新作者测试验证生成 Schema 仍保留这些字段及判等差异。

### 调用方与仓库集成

已检索 SDK 的实际导出、直接调用方及测试。迁移了 apps 测试/fixture、
Task Engine/HTTP/Server/Storage、Check/Probe、SDK 示例、
`examples/task-server` 和 consumer/verification 脚本的发布导入。
历史 Idea 验证脚本与历史证据没有改写。

`check-environment/build.mjs` 去除本次生成的外部 ownership marker 和中间声明，
避免把本机 author 路径带入打包成品。新包进入 workspace、分层、root/package
Objective 交付闭包、tsconfig、内建 settings 生成物和本地 pack 验证 inventory。
它与 task-sdk 一样仍属本地验证 inventory，没有新增 npm 发布授权或 release tag。
为增加包成员且不突破已有 4096-byte subject expression 上限，仅压缩 root
Objective 的说明文字，保留其意图。

## 实际验证

本机版本：Node `v24.12.0`、pnpm `11.22.0`。所有命令在本检查点工作树内运行。
未使用用户现有 Kubo、服务端口、全局配置或 IPFS 数据目录。

| 命令 | 结果与解释 |
| --- | --- |
| `pnpm install --reporter=append-only` | 修改依赖声明后成功安装，锁定 TypeBox 0.34.52。 |
| `pnpm build` | 36/36 workspace build 通过；有既有 CJS `import.meta` warning，不将 warning 当作新功能通过证据。 |
| `pnpm --filter @potential-guide/pguide-task-bundle run build` | 通过；生成的 CLI/作者库可编译。 |
| `pnpm --filter @potential-guide/pguide-task-bundle test` | 8/8 通过：shared Schema 闭包/冲突、发布期间磁盘变化的单快照、链接拒绝、只读 author check、确定性/clean 重建、失败保持旧输出、无源码真实 Worker、严格清单、TypeBox 转换和 CLI metadata/help。 |
| `pnpm --filter @potential-guide/task-sdk test` | 最后独立重跑 14/14 通过，覆盖真实 Worker、日志、资源流、Schema lock 等回归。 |
| `pnpm --filter @potential-guide/task-protocol test` | 101/101 通过；完整 `pnpm check` 中也运行其现有回归。 |
| `pnpm --filter @potential-guide/task-engine exec tsx --test test\bundle.test.ts test\bundle-special.test.ts test\bundle-admission.test.ts` | 最后独立重跑 12/12 通过。不同 CID fixture 改为修改已声明 resource 字节，不再注入未声明文件。 |
| `pnpm exec tsc -p tsconfig.test.json --pretty false` | 全量 build 后通过，包含新的同源类型正反例。 |
| `node scripts\sync-objective-schemas.mjs` | 更新 task 与 task-build 机器 Schema；后续 `pnpm check` 的 schemas check 通过。 |
| `pnpm check` | 最后执行失败：build、layers、format、lint、typecheck 已经过，test 被 `objective-monorepo-standard` 的既有 `.agent/skills/component-responsibility-docs/SKILL.md` file-classification `unverified` 阻断；最终失败列表只有该既有分类项，没有新包 ownership/交付闭包问题。未为此修改无关技能或标准。 |
| `node scripts\check-packages.mjs` | 单独执行失败：`objective-pilot` 的本地生成 `dist/service.js` 无对应 `src/service.ts`，pack 检查判定 stale output。在到达新作者 CLI consumer 场景前已退出；不能宣称新包独立安装/发现已通过。 |
| `git diff --check` | 通过；已接受 Ideal 目录 diff 为空。 |
| `silvermoon check --worktree --audience agent` | 通过。初次检查因 primary 新增同级 Idea 事件而报历史前缀不一致；检查并正常 fast-forward 到 `cf6751a0ec56dc9a6e21887875fc98a0c170407b` 后重新通过，未改写任何事件。提交前仍须检查 staged snapshot。 |

中间修复过本改动引起的 ownership marker 重建冲突、精确清单测试 fixture、
package Objective 注册和 subject 长度问题；它们不是最后结果中的“基线豁免”。
pack stale-output 属于当前本地生成目录状态，尚未通过 clean rebuild 区分其根因；
不得把它说成源码 baseline 已独立复现。
已知 Windows native cleanup 风险在本次最终 targeted 检查没有复现，
不得借先前经验宣称本次失败是 native cleanup。
完整 `pnpm check` 在 test 阶段停止，因此 root script tests、剩余 suite 和后续
`pack:check` 不能统称全部通过。

`.cache/task-bundle-validation/` 的本机日志仅为可丢弃诊断，不入库、不作为换设备必需输入。
此文和测试源码保留了可重新执行的命令、范围及已知失败证据。

## 未完成工作与风险

1. 完成针对新作者工具的审查与覆盖：真实 pguide dispatch/独立安装场景已写入
   `scripts/check-package-consumers.mjs`，但本轮 pack 在到达它之前失败；
   设置优先级、实际 artifact publish CLI、不同安装根的 CID 稳定性及更多
   filesystem/concurrent-build 失败点仍需补充验证。最低 Node 22.13 尚未实跑。
2. 审核当前 SDK 输出事务与崩溃恢复策略。正常失败保持旧输出已有测试；
   staging→output/backup rename、marker/lock 的进程崩溃恢复尚无完整测试。
   不要将当前“操作级替换”描述成所有文件系统上无可见间隙的事务保证。
3. 继续核对 TypeBox whitelist/JSON Schema 支持交集、引用和 tuple/optional/readonly
   类型语义；当前没有宣称覆盖 TypeBox 全部能力。作者 contract 是可信代码，
   本地执行可能有任意副作用，check 不是恶意源码安全沙箱。
4. 完成迁移审计，检查所有非历史文档和调用方是否仍引用旧 `/build` 发布导出。
   保留低层 SDK compiler fixture 的用途需要在最终公共文档中表述一致，
   不得重新引入旧无清单 Bundle 回退。
5. 在不改无关源码的前提下区分已有 file-classification 问题与本地 stale build output；
   使用仓库现有 clean/build 或全新 checkout 重新验证，谨慎处理 Windows
   原生测试资源。不能为绿灯删除用户文件、接管服务或扩大本 Idea 范围。
6. 完成相关 package/script/packed consumer 验证并更新实施证据后，才能逐项勾选 I 项、
   同步 candidate、`submitInner` 并交父代理审批；本检查点所有 I/D 项保持未勾选。

## 换设备后最小恢复步骤

1. 用正常 clone/fetch 获取包含本检查点的 primary，创建/使用隔离工作树。
   不要求复用本机绝对目录；不要访问或修改原用户主 checkout。
   阅读根 `AGENTS.md`、本 Idea 三份契约和本交接。
2. 使用 Node >=22.13、pnpm >=11.22（本轮实测版本见上）。在新设备缺依赖时
   `pnpm install`，再 `pnpm build`；dist、缓存、node_modules 和旧日志都不是迁移输入。
3. 通过已安装的全局 Silvermoon 加载 silvermoon skill，
   `silvermoon whats-next 01M6GWRMT65XKB6QZKPYE6JEXD --audience agent`，
   按当前 report 处理同步/并发 history；不能仅依此文猜测当前 revision 或批准。
4. 先重跑上述 targeted tests 和 `pnpm check`，再处理剩余验证。
   pack 如需 clean，只操作本工作树中明确工具拥有的生成物，不 broad clean 或重写 history。
5. 继续实施需遵守现有父代理门禁。Inner 接受前不做外部部署；
   接受后外部验证也只能用非敏感样例、本地包、单独拥有的数据域/节点，
   不触及既有 3000/4310/5001 服务、用户 IPFS 目录、全局配置或 npm 发布。
   同级 `01M6GRRES5EBHYDP1G9DZEGE8E` 服务配置工作由其他会话拥有，
   不依赖其尚未同步实现。

## 本次资源状态

没有启动 Engine/Kubo/UI/daemon，没有创建其他 agent、worktree 或 Idea。
唯一有界后台 pack 检查已退出；没有需要带到下个设备的进程、端口、pin 或数据域。
测试创建的自有 fixture 目录由测试清理；本工作树的可丢弃编译/验证缓存可能保留，
不影响仓库干净状态，也不得当作外部结果。
