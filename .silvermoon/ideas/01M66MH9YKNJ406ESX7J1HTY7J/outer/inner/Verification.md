# 实施验证

本文件服务于 `Implementation.md`，记录实现候选的可复核证据，不是生命周期审批。
实施基线：`8b10945d7600b25529d7b21e63a43c6810c03f2a`。
所有命令在本工作树执行；未执行工作区依赖安装或升级、未发布 npm、未执行 Deployment 验收。
`pnpm check` 自带的隔离制品消费安装保持原样执行。

## 契约与证据入口

| 标准 | 实现与回归入口（相对仓库根目录） |
| --- | --- |
| I-AC01 时间适用规则一致 | `packages/task-engine/test/event-binding.test.ts`：两种策略事件绑定、prepare 未完成、等号及同毫秒先后、过去/未来锚点、幂等、迟到成功/失败、共享未绑定需求、最后需求回收、取消后释放引用跨重启保留、seal 前后及异步授权拒绝；`projection-races.test.ts`：回拨、cancel/结果竞态、超时事实冻结；`pool.test.ts`：替换重检与物理回收。 |
| I-AC02 破坏升级与重启可证 | `packages/task-engine-storage/test/format.test.ts`：版本 0 非空、1、unknown、旧 checkpoint/Facts/Binding 拒绝，主库/sidecar 字节不变，包括 live WAL；`storage.test.ts` 与 `crash-child.mjs`：真实进程在成功/失败原子提交前后退出，重启保持锚点与绑定，不补查历史；`startup.test.ts`：启动边界恢复；HTTP 测试明确拒绝旧枚举。 |
| I-AC03 内部消费者与制品一致 | `packages/check-task/test/check.test.ts`、`file-source.test.ts`：原 Input 等价、来源拒绝、同步授权契约、真实 worker 与 HTTP/SSE；`packages/probe-task/test/probe.test.ts`：父子取消、动态资源授权、迟到成功与超时并存；原 regulator/coordinator 测试及仓库打包消费者保持独立覆盖。 |

结果 binding 不再以 Prepared 完成作为前提；实际执行与结果验证仍使用该 Execution 的固定内容。
原始请求不改写，snapshot `eligibleAt` 是生效锚点。旧格式不存在别名、迁移器或自动删除路径。
旧库检查副本是短生命周期的自有文件，不是兼容运行库，失败同样清理。

## 已执行命令与过程

1. 核心最小回归：

   ```powershell
   pnpm exec turbo run test --filter=@potential-guide/task-protocol --filter=@potential-guide/task-engine --filter=@potential-guide/task-engine-storage --filter=@potential-guide/task-engine-http --filter=@potential-guide/task-engine-server --output-logs=errors-only
   ```

   实施首轮复验退出 0：10/10 Turbo 任务成功；五包测试分别为 protocol 3、engine 71、
   storage 24、HTTP 4、server 10，合计 112 项通过。
   新增事件矩阵、格式拒绝与真实崩溃用例均包含其中。

2. 内部消费者：

   ```powershell
   pnpm exec turbo run test --filter=@potential-guide/check-task --filter=@potential-guide/probe-task --filter=@potential-guide/objective-regulator --filter=@potential-guide/regulation-coordinator --output-logs=errors-only
   ```

   实施首轮复验退出 0：20/20 Turbo 任务成功；check 20、probe 14、
   objective-regulator 40、regulation-coordinator 79，合计 153 项通过。
   未创建通用 regulator TaskType，也未修改其独立状态格式或其他 Idea。

3. 仓库完整检查：

   ```powershell
   pnpm check
   ```

   首次未通过：`objective-monorepo-standard/test/checker.test.ts` 整文件进程报
   `test failed`，无断言或进一步诊断。随后用
   `pnpm --filter @potential-guide/objective-monorepo-standard exec tsx --test test\checker.test.ts`
   单独复验，25/25 通过；未修改该包或降低测试标准。
   随后的完整复验退出 0；补充取消需求释放引用持久化后再次按
   核心→内部消费者→`pnpm check` 顺序执行，最终完整检查也退出 0。
   最终包含 33/33 build、33/33 lint、33/33 typecheck、66/66 build/test 任务，
   根脚本测试与 `pack:check` 的全部现有隔离消费组合通过，包括 task-adapters、
   mvp-check、probe 相关制品、regulation 和 coordinator。
   这些是仓库内部门禁，未据此勾选 Deployment 项。

4. `git diff --check` 通过；Ideal 目录、`Deployment.md`、`events.jsonl` 与 Git index
   无差异，其他 Idea 未修改。新增文件另用 `git diff --no-index --check` 检查。

## 实施期间发现并修复

- 第一次编译暴露 `executionEvent` 返回联合类型过宽；保留事件类型参数后编译通过。
- 原 comparator 故障测试发现不能在所有 startup owner 均无法等价匹配时仍启动物理执行；
  启动握手已检查至少一个有效、授权且等价的 owner，原测试保留并通过。
- 旧测试假定 Prepared 隔离、严格等号、运行中提前绑定、异步授权以及超时后不结算。
  按新契约更新这些断言，未删除对应身份/授权/物理回收/错误结果保障。
- live WAL 字节测试实际发现普通只读连接更改 SHM；自有检查副本方案修复后，
  主库、WAL、SHM 内容及目录清理测试通过。
- 自查发现取消的未绑定需求不能只把物理释放关联保存在进程 Map。
  现由取消事件持久化 `releaseExecutionIds`，重启后缺少真实退出证据仍报
  `reclamation_unconfirmed`，而不是伪造结果绑定或声称已经物理回收。
- 首次批量格式命令在 Windows 参数传递上未处理任何文件；改用显式路径运行 Biome，
  并撤销工具造成的无关 import 排序变化，没有用格式化掩盖语义改动。

## 父代理监督修正

- 将 `injected legacy facts and historical rebinding are rejected` 与
  `canceled unbound demand retains physical release references across recovery`
  移为顶层独立测试，保留其所有断言与清理；seal 场景的替换、迟到结果、
  后到需求拒绝及重放断言保持完整，不再与这两项测试生命周期嵌套。
- Probe 授权使用最小 `probeResultReferences` 访问 helper：复用
  `validateProbeResult`，经 JSON 结构收窄与 `validateArtifactReference` 验证后读取引用，
  不新增类型断言或双重断言。不改变原有结果重放路径；
  继续授权每个操作请求引用及 resolve 选中内容引用。
  测试明确枚举动态引用序列，并覆盖畸形 operation/reference 的拒绝。
- 监督修正后的定向验证均退出 0：

  ```powershell
  pnpm exec turbo run test typecheck --filter=@potential-guide/task-engine --filter=@potential-guide/probe-task --output-logs=errors-only
  pnpm exec tsc -p tsconfig.test.json --pretty false
  pnpm exec biome format packages\task-engine\test\event-binding.test.ts packages\probe-task\src\index.ts packages\probe-task\src\contracts.ts packages\probe-task\test\probe.test.ts
  ```

  22/22 Turbo 任务成功；engine 71 项、probe 15 项测试通过；
  测试源码类型检查通过，四个修正文件格式检查通过。
  修正后的最终候选执行一次 `pnpm check`，退出 0，现有打包消费组合全部通过。
  AST 检查另外确认上述两个 test 调用没有包围它们的测试函数；
  `git diff --check` 通过。完整检查继续保留已有 lint 警告及缺失 `config` 路径诊断，
  未为本轮修正更改无关配置。

## 审查边界

父代理负责最终候选审查、Silvermoon 检查、同步与精确 revision 提交/验收。
内部门禁证明不等于独立制品外部验证，D 项保持未完成。
完整检查中的已有 lint 警告及缺失 `config` 路径诊断不作为通过证据隐藏；
以命令最终退出码及下游实际执行结果为准，不在本 Idea 修复无关配置。
无遗留阻塞。仍需父代理评估同步授权的破坏性接口变更、可变未 pin Input 的共享含义，
以及只读检查副本需要同目录可写空间；复制期间源变化明确报冲突，不承诺在线迁移。

## 修改清单

- `packages/task-protocol`：类型、投影/reducer、同步授权检查与 README。
- `packages/task-engine`：接收/事件绑定/需求保护/恢复/释放关联，以及 engine、
  pool、projection-races 与新增 event-binding 测试。
- `packages/task-engine-storage`：版本边界、只读格式检查、README、真实崩溃测试及新增 format 测试。
- `packages/task-engine-http/test/http.test.ts`：旧枚举公开入口拒绝。
- `packages/check-task`：独立同步来源授权、实际事件策略消费、相关测试与 README。
- `packages/probe-task`：原执行与动态结果资源授权、父子共享/超时回归及 README。
- `docs/task-engine.md`、`docs/task-server.md`：公开契约和破坏升级说明。
- 本 Idea：`Implementation.md`、`Preparation.md`、本文件及 `ledger.md`；
  I 项按上述证据完成，D 项全部未完成。
