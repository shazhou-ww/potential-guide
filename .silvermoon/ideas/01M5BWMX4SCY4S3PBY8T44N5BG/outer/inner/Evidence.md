# 实现与验证证据

验证环境：Windows，Node.js 与 pnpm 使用工作区既有工具链。基线为 `d6c2966d5e130cdf9c44b3d428e6b58693f2bcf6`（父会话已独立证明基线 `pnpm check` 通过）；实施前整合 `3e77cce9a44e8ad64feb5209f944a65e918167a7` 的来源/evidence 能力，提交前普通整合 primary 的后续追加历史。这里不把历史失败当作默认豁免。

## 交付范围与接线

| 范围 | 实现 | 直接证据 |
| --- | --- | --- |
| 问题/观察协议 | Manifest schemaVersion 仍为 1；删除并拒绝两处 prerequisite。internal 保留 scoped ref/parameters；dependency 只有 kind/objectiveId/subject/expectedLevelId/currentLevelId；current 固定为当前 Objective | [类型](../../../../../packages/objective-pilot/src/types.ts)、[Pilot](../../../../../packages/objective-pilot/src/pilot.ts)、[校验](../../../../../packages/objective-pilot/src/validation.ts) |
| 库函数与 probe | checkObjectiveLevel 返回 Effect/Envelope 的 passed 与同次 observation；probe 单次观察转换 true/false，错误和取消不伪造 false；true/false 均贡献版本 | [依赖实现](../../../../../packages/objective-pilot/src/dependency.ts)、[API 测试](../../../../../packages/objective-pilot/test/dependency.test.ts) |
| 跨进程来源 | Node process probe 的 IPC 请求绑定到生成该进程的观察作用域；拥有来源的组合层加载固定 Git 快照和外部 executable/runtime。stdin/stdout 协议不变，正确性不依赖 report 是否启用 | [process adapter](../../../../../packages/objective-pilot/src/probes.ts)、[来源绑定](../../../../../packages/pguide/src/pilot-source.ts)、[双仓库测试](../../../../../packages/pguide/test/pilot-source.test.ts) |
| bare import | 快照不包含 node_modules；受控 Node preload/loader 只将 @potential-guide/objective-pilot 映射到拥有者已安装的运行时，其余模块正常解析。不安装目标依赖，不运行安装脚本，不加载目标任意 package export | [preload](../../../../../packages/objective-pilot/src/dependency-preload.ts)、[单一映射 loader](../../../../../packages/objective-pilot/src/dependency-loader.ts) |
| 同次证据、预算和取消 | 根作用域共享精确 versions、固定 binding、截止时间、总次数预算；Objective ID + canonical subject 检测递归栈。IPC 外部观察在同一拥有者作用域执行，外部调用结束后才清理。非 Node 保留三管道协议 | API 测试包含实际子进程递归、深度/总预算、外部进程取消/目录清理和禁用 IPC 场景 |
| Regulator | target-reached 优先；未达目标且存在任意 dependency 时交接全部依赖，混合 internal 也零 Agent，不新增 stall；其他 outcome 不携带 dependencies | [实现](../../../../../packages/objective-regulator/src/index.ts)、[测试](../../../../../packages/objective-regulator/test/objective-regulator.test.ts) |
| Planner/Coordinator | 多依赖与实例合并、逐消费者阈值、动态精确版本 resolver、实际等待环、孤立目标回收及迟到隔离；Coordinator 仍用 goals/resources/result，不自动扩权 | [Planner](../../../../../packages/objective-portfolio-supervisor/src/planner.ts)、[测试](../../../../../packages/objective-portfolio-supervisor/test/objective-portfolio-supervisor.test.ts) |
| 实际 CLI 闭环 | 临时双 Git 仓库中的 run.js 真正 bare import 现有包；消费者零 Agent 交接，动态加载精确提供者版本、一次 Agent 修复，再次独立观察消费者 terminal | [supervise 集成测试](../../../../../packages/pguide/test/supervisor-cli.test.ts) |

### 动态等待撤销修正

父会话独立重现发现：消费者未达到最终 target、但新的可信 observation 已不再需要原依赖时，旧等待可能永久抑制消费者。现按最新问题集合核对实例、最低层级及版本；撤销不再适用的等待并更新 demand revision。出现新依赖时解除旧阻塞，让 Regulator 重新观察并交接，而不是直接宣布消费者成功。共享提供者只有在没有其他存活所有者时回收。

回归覆盖：依赖消失但仍有 internal 问题、共享另一消费者继续等待、B 改为 C、旧 revision 反馈隔离，以及显式提供者 subject 替换时保留旧实例。

父会话原始复现命令（只读临时脚本、不入仓）：

```powershell
pnpm exec tsx C:\Users\Wei\.copilot\session-state\30d45d83-0689-4fa5-ad7d-6ae3229749cb\files\dependency-parent-withdrawal-repro.mts
```

修复后退出 0，输出 `{"phase":"dependency-withdrawn-but-internal-work-remains","queuedIds":["consumer"]}`。

## 执行的验证

先运行 Pilot、Regulator、Supervisor 与来源绑定的定向测试，再构建及执行完整检查。关键精确命令：

```powershell
pnpm exec tsx --test packages\objective-pilot\test\dependency.test.ts packages\pguide\test\pilot-source.test.ts
pnpm exec tsx --test --test-name-pattern="dynamically binds" packages\pguide\test\supervisor-cli.test.ts
pnpm exec tsx --test packages\objective-portfolio-supervisor\test\objective-portfolio-supervisor.test.ts
pnpm check
pnpm exec turbo run test --continue=always
node --test scripts\*.test.mjs
pnpm run pack:check
```

- bare import 适配后的依赖 API + 双仓库来源定向命令：19 项全部通过，实际使用 IPC 和临时 Git 仓库，不是只验证进程内 import。
- bare import 适配后的动态 supervise CLI 定向命令：1 项通过，独立断言消费者归属、提供者完整 commit、交接 iterations=0、重新观察 terminal、队列清空和仅一次执行 Agent prompt。
- 动态等待撤销修复后的 Supervisor 定向命令：37 项全部通过。
- 最终 `pnpm check`：退出 1。format:check、12 workspace lint、12 workspace typecheck 及测试类型检查通过；四个既有运行时生成一致性检查通过。测试在未迁移真实 monorepo 探针处失败，因此该链没有自动运行到 pack:check。
- 为避免 fail-fast 掩盖其他包，另以 `--continue=always` 收集全工作区测试；最终各包统计见下表。失败项仅限下一节明确列出的真实旧协议集成。
- 独立根脚本测试：32/32 通过；独立 pack:check：退出 0，12 workspace build 与包校验通过。没有 npm 发布。

| 工作区测试 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: |
| effects | 12 | 0 | 0 |
| git-source | 18 | 0 | 0 |
| cli-core | 82 | 0 | 0 |
| config | 8 | 0 | 0 |
| objective-pilot | 43 | 0 | 0 |
| objective-regulator | 39 | 0 | 0 |
| objective-portfolio-supervisor | 37 | 0 | 0 |
| objective-devbox-health | 15 | 0 | 0 |
| objective-pguide-self-check | 1 | 0 | 0 |
| objective-monorepo-standard | 34 | 2 | 0 |
| objective-pguide-setup | 34 | 1 | 0 |
| pguide | 66 | 0 | 2 |

两项 pguide 跳过沿用现有 Windows 条件：文件符号链接权限、真实路径大小写语义；未新增跳过测试。

## 明确保留的集成阻塞

以下不是基线固有失败，也不声称“全绿”。它们是新协议严格拒绝用户明确排除迁移的真实旧探针输出所造成的切换阻塞；未通过兼容层、跳过或弱化断言掩盖。

| 测试 | 实际原因与证据 |
| --- | --- |
| monorepo: real probe stops at structure for invalid contract and does not fall through to deliveries | [真实 check.mjs](../../../../../packages/objective-monorepo-standard/check.mjs) 的失败分支仍输出无 kind 的 `{ id, parameters }`。新 parser 拒绝，状态 502 而不是测试期待的 200 |
| monorepo: a valid internal package reaches Pilot terminal without execution or online proof | 该 fixture 的后续非通过检查仍由同一个真实旧 adapter 输出旧问题，最终 502；不是层级顺序或目标达标被误判 |
| setup: Git subdirectory snapshot coordinates long local budgets and existing file-auth ACP to terminal | 首个实际 terminal 路径已通过；测试随后刻意移除目标环境变量时，[真实 contract.mjs](../../../../../packages/objective-pguide-setup/src/contract.mjs) 仍输出无 kind 问题，被拒绝为 `process-protocol: Expected fields: kind, id, parameters.`，CLI 退出 6 |

直接复核 monorepo 根因使用了实际 `main("structure", { root: process.cwd(), contract: "missing-dependency-migration-proof.json" })` 和新 `parseCheckEnvelope`：原始状态 200、首个问题 id=structure-incomplete 且没有 kind；parser 明确报 `Expected fields: kind, id, parameters.`。没有创建该缺失路径文件。

setup 首次有七项失败，其中六项来自打包的 nonce **sanity-fixture 测试 Objective** 的旧问题字段。依照用户允许更新测试 fixture 的边界，只给该 fixture 增加 kind:internal 后重跑：35 项中 34 通过，余下的一项才是上表真实环境问题输出边界。未改真实 setup 的 Manifest、contract/runner、检查 wrapper 或生成 runtime。

## 覆盖与未验证边界

- 已接受 ideal 树保持不变；root ledger 只镜像实施与部署复选项，不记录运营说明。
- 已删除旧 prerequisite API/停止原因；Manifest 未做无关版本升级。内部问题 ID、Wiki、多语言、并发顺序、非依赖治理、权限、配额、进程清理与报告功能有回归验证。
- 当前工程与 Silvermoon 工程的真实 Objective 定义、探针、派生产物均留待之后手动迁移；本次只更新实现测试 fixture、新协议测试与直接相关文档。
- 未将临时 fixture 治理声称为现实世界部署验收；没有发布 npm，也未执行未接受的 outer 阶段。
- 普通 Git/进程可控测试不证明任意远程 HTTP 服务会停止业务工作；HTTP 取消仍只承诺本地请求终止。裸 dependency payload 不能替代同次受控来源证据。
