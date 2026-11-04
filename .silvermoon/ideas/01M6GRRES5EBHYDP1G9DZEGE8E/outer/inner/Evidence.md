# Task Engine 服务命令实施证据

## 候选与边界

验证环境为 Windows、Node `24.11.1`、pnpm `11.22.0`。
原分支 HEAD 为 `8c817d434f81ed2aef3dd624d6ac8aeb226b8e56`，
服务检查点为 `6d9a6d6f471c42509ead3108108630b9d3425bf0`。
普通合并 `c36bed4d` 保留双方历史；唯一内容冲突是生成文件
`packages/pguide-cli-core/src/built-in-settings.ts`，以同时扫描 apps/packages 的生成器重建，
未丢弃 Task Bundle 设置或作者工具。

工作者没有改动 Ideal、events、Deployment 或其他 Idea 的生命周期，也没有发布 npm。
本文件证明 Inner 的实现与受控验证；真实 Kubo/非敏感 Bundle 的外部消费仍属于 Outer。

## I-S01 / I-AC01：入口与配置

- `apps/pguide-task-engine` 提供标准 `pguide-command-v1` 元数据、结构化 help 和独立 binary。
  顶层只为 `task-engine` 透传 `--config`，其他命令仍拒绝已退役的全局 `--config`。
- 服务解析器执行 CLI > 显式 YAML/JSON > pguide 用户 JSONC > 默认值；
  每个启用层先校验，再以完整 setting ID 覆盖。`uiOptions` 整体替换，不深合并。
- 数据库与收藏文件分别按自己的来源目录解析；CLI 与 `--config` 参数相对有效 `--cwd`。
  CLI 默认值不会变成显式覆盖值；项目服务值不参与装配。
- `--no-global-config` 同时穿过上层发现和独立入口，跳过用户主文件及其 commandDirectories；
  PATH/项目发现仍遵循原机制，未自动写入用户配置或注册包。
- 配置测试覆盖缺省/用户/文件/CLI、跨来源路径、未知字段、类型与地址非法、
  被覆盖的非法值、完整对象要求、重复 YAML 字段、YAML tag、缺失文件和旧 `.mjs`。
- 进程测试在两个入口上验证损坏用户文件的失败/禁用、冲突项目值排除、help 无 RPC、
  `--cwd`/文件透传、显式端口覆盖及用户数据库相对锚点；旧模块的副作用标记始终不存在。

对应测试：`apps/pguide-task-engine/test/config.test.ts`、`test/cli.test.ts`。

## I-S02 / I-AC02：装配、HTTP 与所有权

- `createIpfsClient` 将字符串 CID 转换后交给标准 Kubo RPC client；
  受控 HTTP RPC fixture 观察到指定地址的 `/api/v0/block/get` 请求及返回字节。
- 仅接受 `127.0.0.1`、归一后的 `localhost` 和 `::1`；
  本地 Caller `local-cli` 只允许配置 scope 及显式操作集合。
  Host、Origin、Fetch Metadata、方法和 JSON POST 策略均有拒绝测试。
- 选择 UI 时只传 HTTP endpoint，不传 Engine/Store；
  UI 静态资源、bootstrap、公开 HTTP 列表代理及取消路由均被真实 listener 验证。
  UI 代理为所有 POST 提供 JSON Content-Type，修复无 body 取消与本地策略之间的兼容缺口。
- 无 UI 时没有 UI listener。关闭同时释放 Engine/UI；UI 端口占用时回滚 Engine，
  验证旧 Engine 地址不可访问、同一端口与数据库可重新启动，
  且被占用的既有服务仍可访问。
- 两个 CLI 入口还覆盖 UI 启动失败的非零退出、无 ready 事件、Engine listener 回滚，
  并证明既有占用端口服务未被停止。非法配置在数据库创建前拒绝。
- Windows 的强制终止不是可捕获 POSIX signal。测试 wrapper 通过 IPC 触发 Node
  SIGTERM 事件，观察 `closed`、进程 `exit` 和 listener 不可访问；
  pguide 分派链另以此次 ready 输出的 PID 验证进程退出。
  不再等待 Windows IPC 下可能不结束的 ChildProcess `close`，退出等待有界。
- 程序化 `startTaskServer` 的 client/认证/授权回调注入保留；
  旧执行模块 CLI 删除，不引入 Kubo 生命周期、共享 client 关闭或浏览器关闭取消。

对应测试：`apps/pguide-task-engine/test/service.test.ts`、`test/cli.test.ts`，
以及原 Server、IPFS、UI 回归。

## I-S03 / I-AC03：验证结果

| 命令/检查 | 实际结果 |
| --- | --- |
| `node scripts\build-settings.mjs` | 初次因缺少 `ajv` 失败；随后才执行 `pnpm install --reporter=append-only`，安装与重新生成成功。 |
| `pnpm exec turbo run build --filter=@potential-guide/pguide-task-engine --filter=pguide --output-logs=errors-only` | 25/25 任务成功。 |
| `pnpm --filter @potential-guide/pguide-task-engine test` | 4/4 通过；最终全量运行也再次证明 4/4，包括后补的双入口启动失败测试。 |
| `pnpm exec turbo run test --filter=@potential-guide/cli-core --filter=pguide --filter=@potential-guide/ipfs-content --filter=@potential-guide/task-engine-server --filter=@potential-guide/task-engine-web-ui --output-logs=errors-only` | 29/29 任务成功，含程序化、共享设置/分派、IPFS 与 UI 回归。 |
| `node --test scripts\*.test.mjs` | 37/37 通过。发布相关测试使用受控模拟，没有执行发布。 |
| 最后一次 `pnpm typecheck` 与定向 Biome lint | 37/37 typecheck 任务成功；定向 lint 退出 0，有 8 条非空断言警告，无错误。 |
| `node scripts\check-packages.mjs --task-service` | 通过；全部本地包完成 tarball 检查，独立消费者选择 pguide 与新命令，遍历 21 个内部包。验证两种入口、隔离配置、Engine-only/带 UI、三份浏览器资源、跨站拒绝及退出后不可访问。 |
| `pnpm check`（最终候选） | **退出 1**：build、layers、format、lint、typecheck 均通过；Turbo test 66/74 任务成功后，在 monorepo-standard 既存文件分类问题停止；该包 57/58 通过。根脚本测试与 pack 阶段因短路未运行，已分别单独执行。 |
| `pnpm pack:check` | **退出 1**：37/37 构建成功，全部 tarball 检查成功；真实 packed Check/Probe HTTP history/SSE 消费通过，随后旧 task-sdk 消费 fixture 因缺少精确 include manifest 失败，因此未到服务场景；服务场景已通过上面的独立选择器单独验证。 |

### 基线与本次失败的区分

1. 最终 `pnpm check` 唯一已报告失败为
   `.agent/skills/component-responsibility-docs/SKILL.md` 的 `file-classification: unverified`。
   曾发现且已修复本次新增 app 的 roles、apps 放置例外、联合交付成员和已删除 CLI entry；
   新增 workspace 对应的实际仓库测试数量由 36 更新为 37。
   根 JSONata 投影仍在现有 4096 字节限额内，未放宽该约束。
2. 在本仓库 `.cache/task-service-baseline` 创建原 HEAD `8c817d434f81ed2aef3dd624d6ac8aeb226b8e56`
   的只读 detached checkout，使用相同 `checkRepository(subject, 1)`：
   **复现完全相同的文件分类 finding**。该操作拥有的 checkout 已删除。
3. 同一 baseline 的 `checkPackage` 还复现 UI `src/ui/data-table.tsx` 的三个
   `source-import-resolution: unverified`：现有观察器缺少 `.js` 到 `.tsx` 的映射。
   当前与原 HEAD 的该 UI 文件及观察器 `src/shared.ts` 没有差异。
   此旧观察限制不影响本次实际 TypeScript 构建和 packed UI 消费，未顺带修改。
4. 全量 pack 的旧 `scripts/check-task-sdk-consumer.mjs` 在生成的 declaration 中缺少
   Task Bundle 检查点已要求的 include manifest；它及 `packages/task-protocol/src/bundle.ts`
   相对原 HEAD 均未改动。未为使全量命令变绿而改写另一个 Idea 的 Bundle 规则。
5. 最早一次 `pnpm check` 曾在未改动的 task-engine `type-supervisor` 测试出现启动超时：
   159/160 通过。隔离命令
   `pnpm --filter @potential-guide/task-engine exec tsx --test --test-name-pattern="卡死的类型不会卡死宿主" test\type-supervisor.test.ts`
   为 1/1 通过；这是并发运行观测，不宣称已证明历史 HEAD 全量也超时。

## 可审查交付物与剩余责任

- 配置/装配/元数据：`apps/pguide-task-engine/src/{config,service,main}.ts`。
- 真实安装证明：`scripts/check-task-service-consumer.mjs`；
  `check-packages.mjs --task-service` 可独立重现，不需要 npm 发布或真实用户配置。
- 打包 inventory 同时支持 apps/packages、TS/TSX 输出和 UI 必需资源；
  新 app 仅进入本地验证 inventory，没有增加发布标签授权。
- 指南同步了 pguide、Server、UI、示例 YAML 和 Run Logs 的程序化迁移说明。
  原 `IPFS_API` 等示例环境变量没有成为新的隐式覆盖层。
- 剩余基线问题如上；没有遗留本次测试进程或接管用户服务。
  外部真实 Kubo、独立非敏感 Bundle、primary 同步和生命周期提交/审批交由主代理，
  不在本次工作者结果中冒充完成。
