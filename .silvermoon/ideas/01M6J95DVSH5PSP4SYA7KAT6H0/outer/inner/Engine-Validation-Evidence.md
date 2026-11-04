# Engine 统一校验实施证据

## 最新完整检查结论

按用户“同步最新 main，继续修到 pnpm check 通过”的授权，已保存实现到
`d6c9b0d1`，再以 `60a1ed3e` 合入 primary 的 `0a7a0d32`。原有四项共享修改
与该 primary 提交内容完全一致，合并前后逐文件 Git 内容摘要核对相同，未丢弃。

最新 main 的测试隔离与并行上限修复使完整测试阶段通过。随后真实包检查暴露
两个独立问题，均未跳过检查或删除负控制：

- SDK 拆分前的 dist/artifact、build、publish 残留被旧 typecheck 缓存重新恢复。
  只清理 SDK 自有 dist，强制重建并刷新 SDK 的 build/typecheck 两份缓存，
  未清理共享缓存根目录、改动生产时限或掩盖包文件检查。
- authoring 的生产宿主位于仓库下，缺失依赖控制意外解析到祖先 TypeBox。
  改为仓库外 canonical 临时宿主，复制已验证区块，仅安装 Engine 运行依赖；
  缺失 SDK/作者工具/TypeBox 的真实负控制仍执行。成功或失败均 finally 清理
  自有目录，新增测试证明祖先依赖隔离、错误传播和清理。定向四项隔离测试通过，
  `node scripts/check-packages.mjs --bundle-authoring` 的真实打包消费通过。

最终原样执行 **`pnpm check`，退出 0**：layers/build、format、lint、
typecheck、全部 workspace 与根脚本测试，以及完整 pack:check 全部通过，
包括最终 combined 和仓库外 Bundle authoring/Engine/真实 Worker 消费。
此结论替代下文历史失败状态；I-AC02 的实施工作已完成，不代表自动记录生命周期
accept 或完成最低 Node/断网等独立 Deployment 门限，也未发布 npm。

## 授权、范围与流程

用户在本轮明确改为 Engine 统一承担 input/result/message 契约校验，授权更新三份
world 契约，不再沿用“Worker 必须执行预生成 validator”的旧边界。
[Evidence.md](Evidence.md)、Baseline/Current 数据保留为旧边界历史，不当成本轮接受。

开始时 Silvermoon whats-next 报共享脏工作树，阻塞 clean-worktree 整备；按本轮明确
代码授权继续实现，没有清理、暂存、提交、推送、修改事件日志或记录接受/豁免。
新的 Idea 内容会使旧 ideal revision 不再代表当前定义，交由父 agent 最终处理。

保留了父本轮已写的 opaque CID 配置、worker barrel 的 CID export 移除、
Worker/宿主 CID 与声明不匹配握手测试和 CID 文档。未修改未知 `.gitignore`、
`biome.json`、task-engine-server/test/run-logs.test.ts、check-task/test/restart.test.ts。
build/artifact/publish 仍在 pguide-task-bundle；SDK 仍只有运行时。

## 实现与 ACK 生命周期

- 构建保留 validateTaskBundle/resolveBundleSchemas、闭包/引用/预算及原子输出检查，
  去掉三份 precompileSchema 调用和 task-validator 虚拟模块，仅绑定 JSON 声明。
  SDK binding 只含 declaration，worker surface 不再 export schema-runtime。
  协议普通/standalone 编译 API 和 schema-runtime 文件仍留给宿主消费者，未无关删除。
- Worker 的 input/message 仅保留 JSON/字节协议边界，信任 Engine 已完成业务校验；
  checkpoint、return 和 RunFailure 证据都不在 Worker 按业务 Schema 解释。
  generation/Run 路由、队列/字节、声明一致性、opaque CID、日志/进度、取消和流保留。
- SDK 对 complete 的 NACK 捕获宿主错误，报告 failed；不再沿 success 分支拒绝后
  直接变 uncertain 丢失可靠失败。checkpoint 的拒绝保存在 sticky outputError，
  即使回调捕获异常并返回合法值，也报告失败。RunFailure.result 的 NACK 后，
  用宿主错误重报不带被拒证据的 failed，ACK 后再 released。
- 同步 postMessage 失败会释放 pending credit 并拒绝其 promise；不会留下永远等待
  的已登记请求。清理不确定标记保持 sticky，不被较优先的输出错误覆盖。
  存储/通道无法确认时仍 uncertain，不伪造终态或资源回收。
- Engine 的 run/input、sendTaskMessage 与 supervisor/message 校验保留。receive 的
  checkpoint/complete/failed.result 在 channel 接纳/持久化前检查；拒绝业务输出
  记入 rejectedOutput，后续 complete 不能覆盖，failed 不能接纳被拒证据。
  自定义 Worker 忽略 NACK 后退出时，宿主仍生成明确 failed，再报告物理 exit；
  原资源动作/证明和 released 的回收条件不变。

## 真实验证

- 新增 bundle-contract-host.test.ts：19/19 通过。十一组明确有效/无效的
  required/optional、数值/字符串、tuple/数组、pattern/record、组合/条件、
  boolean/Never、引用 siblings/unevaluated、原型名称字段，分别经过真实
  TypeSupervisor 输入、消息和结果边界；不是 permissive ACK mock。
- 同文件使用真实 createTaskEngine/MemoryStore 验证非法 result、checkpoint、
  被吞的 checkpoint 拒绝、非法 RunFailure 证据、有效证据和 malformed JSON：
  Run failed、exit/reclaimed、无非法 result/evidence 持久化；单容量的失败后
  再接纳第二 Run，证明回收后可复用。真实 Engine 拒绝 input 在回调前、拒绝
  message 在消息持久化前，合法消息仍执行。自定义 Worker 忽略 NACK 不能改成成功。
- 与父已有 type-supervisor、supervisor-review、bundle-admission 一起定向运行：
  54/54 通过；保留 CID/Schema handshake 拒绝测试。
- 迁移后的 pguide-task-bundle 全部测试串行：107/107 通过，含 authoring、
  binding manifest、CAR、init 独立 TypeScript、日志、流、自定义封装、
  独立 SDK 副本及数据矩阵。precompile.test 的一般数据路径现在使用真实
  TypeSupervisor；只有 opaque identity/config 测试使用原始 Worker 驱动。
- task-protocol 121/121、runtime-only SDK 1/1 通过，保留普通/standalone 能力。
  定向 tsc 通过；Biome 定向 lint/format 通过（既有非空断言警告不冒充失败）。
- 全量 pnpm check 本轮只运行一次，退出 1。layers/build、format、lint、
  typecheck 和测试前置检查已经通过；Turbo 报 68 successful / 76 total，
  task-engine 为 180 项中 179 通过、1 失败。失败是 supervisor-review.test.ts:328
  的 R02 资源动作超时案例，在投递前遇到 `type_unavailable: 类型守护启动超时`
  （releaseConfirmed=true）；此案例在本轮 54 项定向中通过。这里只记录观测到的
  startup timeout，不把定向/代理通过当成完整通过，不改时限、不重跑全 suite 凑绿。
  测试阶段已中止，因此整套 pack:check 没有由该命令完成，不能声称它通过。

## 精确体积与复现

[CID-Baseline.json](CID-Baseline.json) 与 [Engine-Validation.json](Engine-Validation.json)
给出所有文件、Worker SHA-256/CID 和逐依赖 bytesInOutput；版本均为 Node v24.11.1、
esbuild 0.28.2，锁 SHA-256 为
`bfc208ba28dfcbfe4efaa440b49ab19e1493d87371796ed87b196ade531eccdb`。

基线脚本只在自有 fixture 中读取提交
`a38bfa625ff504fcd56993705cc0f10c0ca6e4a1` 的旧 builder/SDK，加上父本轮
CID opaque delta；通过现有 TypeScript 配置转译，并恢复宿主仍存在的 contract API。
这精确复测出父观测的 20784/21547，而没有覆盖/回退共享源码或清理未知修改。
schema-runtime 不从仓库删除，也没有为复测新增工具或依赖。

| 实际 init/案例 | Worker 原始字节 | Bundle 所有文件字节 | sibling CAR 字节 |
| --- | ---: | ---: | ---: |
| CID 精简后的旧校验基线 | 20784 | 21547 | 22194 |
| 新 Engine-only 默认 | 11196 | 11959 | 12604 |
| 新共享引用/组合 | 11363 | 12540 | 13272 |
| 作者主动 validator | 154833 | 155596 | 156243 |

默认 Worker 和 Bundle 都减少 9588 字节；三个 Schema 合计 399、task.yaml 364
仍共 763 字节，没有转移代码。CAR 也下降；同时保留目录与 CAR 的物理总量由
43741 降至 24563 字节，不把 archive 重复交付藏掉。
旧默认可归因 schema-runtime 6512、validators 2435 字节；新默认二者均 0，
八个输入模块无 Ajv（包括 runtime helpers）、fast-uri 或 multiformats。
代表性任务同样没有这些模块；作者主动 validator 才引入普通编译路径及其依赖，
该显式依赖仍真实执行，未把它当 SDK 固定成本。

每次正式 build 的 Worker 与分析 compile 字节相同；default/repeat 独立目录的
Worker SHA-256 和 CID 相同。没有绝对机器路径或时间戳进入生成 Worker。
SDK 本身没有 external 非内置代码；所有声明/引用仍随 Bundle 完整交付。

```powershell
node .silvermoon\ideas\01M6J95DVSH5PSP4SYA7KAT6H0\outer\inner\Measure-CID-Baseline.mjs a38bfa625ff504fcd56993705cc0f10c0ca6e4a1 cid-baseline-repro.json
node .silvermoon\ideas\01M6J95DVSH5PSP4SYA7KAT6H0\outer\inner\Measure.mjs . engine-repro.json --expanded
```

基线脚本固定的改动仅重现父 CID delta；声明绑定/Schema 编译仍是旧实现。
两脚本的 fixture 都在仓库内且 finally 删除自有目录；保留的 JSON 是本次真实结果。
旧 34148/34911 以及更早 baseline 属于先前职责，不作为本轮直接对照。

## 交付边界

### 后续 IPC 载荷检查职责调整

用户随后明确授权把 JSON、结构和字节及日志/进度载荷检查也统一交给 Engine。
SDK 不再遍历 input/message、checkpoint、complete 或失败证据；启动声明比较仍
保留 canonical JSON。宿主禁用日志存储时也先验证收到的日志，再决定回执。
超过字节上限的 checkpoint 拒绝同样被宿主记住，不能被之后的合法结果掩盖。

发送不可克隆值会拒绝本地操作并释放在途额度，不提前消耗业务或诊断序号，
因此仍能发送失败报告和后续有效日志。可克隆的循环、Date、BigInt、超深或超大
值由宿主拒绝；structured clone 可能执行 getter 并转换对象原型，宿主检查的是
接收表示，不是作者原对象描述符。接纳字节限制不等于 IPC 分配前内存保护。

本次类型检查、定向 Biome 检查、作者工具全套加真实宿主测试 136/136 通过。
正式 init 测量的 default/repeat 字节和 CID 相同，分析与磁盘 Worker 字节相同：
Worker 11,196 降到 9,965 字节，Bundle 文件总量 11,959 降到 10,728，
CAR 为 11,373 字节；七个模块中无 Schema runtime、validator、Ajv 或 multiformats。
JSON 模块仍贡献 1,661 字节用于启动声明绑定和共享错误，并未宣称全部移除。

原样 `pnpm check` 的构建、格式、lint、类型检查通过，测试阶段在 check-task 的
Worker 启动超时及 HTTPS 重启等待失败，Turbo 为 67/76；未进入完整 pack 检查。
对未修改的 check.test.ts 和共享已有修改的 restart.test.ts 仅做串行复验，
11/11 通过，未修改它们或放宽时间阈值。这不替代全量通过，也未接受或部署。

### 父会话独立门限检查

父会话检查了 SDK 的输出拒绝处理及 Engine 的拒绝记忆、接纳前验证和实际退出
分支，并独立执行 `pnpm exec tsc -p tsconfig.test.json --pretty false`，通过。
联合执行 `bundle-contract-host.test.ts` 和 `supervisor-review.test.ts`，新边界的
19 项全部通过；总计 31/33，另两个失败均为 R02 在业务投递前启动超时。
用 `--test-concurrency=1` 去除这两个文件的并行后，结果仍为 31/33，
相同两项启动超时，因此不能仅凭本轮结果把失败归结为跨文件并行争用。
未更改超时、跳过案例或将定向结果当成完整检查通过。

父会话复核记录中的默认 Worker 为 11,196 字节，Bundle 文件总量为
11,959 字节，八项输入模块中确实没有 schema-runtime、task-validator、
Ajv、fast-uri 或 multiformats。代码与核心行为检查已完成，但完整检查
仍未通过，I-AC02 及正式实施/部署接受保持未完成。

本轮只交付工作树与证据，不 stage/commit/push/submit 或接受任何 gate，不发布。
所有 Deployment checkbox 仍未完成；独立外部消费、最低支持 Node、断网隔离和
用户/父 agent 对新定义的正式审阅仍未以此替代。
Silvermoon check --worktree 退出 0；这只是共享候选的 snapshot 合法性，
不等于 clean worktree、完整 pnpm check 通过或任何阶段接受。

本轮增量文件（含与父既有修改整合的文件）：

```text
packages/task-sdk/src/index.ts
packages/task-sdk/src/binding.ts
packages/task-sdk/README.md
packages/task-protocol/src/worker.ts
packages/pguide-task-bundle/src/build.ts
packages/pguide-task-bundle/test/precompile.test.ts
packages/pguide-task-bundle/README.md
packages/task-engine/src/type-supervisor.ts
packages/task-engine/test/bundle-contract-host.test.ts
docs/task-bundle-worker.md
.silvermoon/ideas/01M6J95DVSH5PSP4SYA7KAT6H0/outer/inner/ideal/Idea.md
.silvermoon/ideas/01M6J95DVSH5PSP4SYA7KAT6H0/outer/inner/Implementation.md
.silvermoon/ideas/01M6J95DVSH5PSP4SYA7KAT6H0/outer/Deployment.md
.silvermoon/ideas/01M6J95DVSH5PSP4SYA7KAT6H0/ledger.md
.silvermoon/ideas/01M6J95DVSH5PSP4SYA7KAT6H0/outer/inner/Measure.mjs
.silvermoon/ideas/01M6J95DVSH5PSP4SYA7KAT6H0/outer/inner/Measure-CID-Baseline.mjs
.silvermoon/ideas/01M6J95DVSH5PSP4SYA7KAT6H0/outer/inner/CID-Baseline.json
.silvermoon/ideas/01M6J95DVSH5PSP4SYA7KAT6H0/outer/inner/Engine-Validation.json
.silvermoon/ideas/01M6J95DVSH5PSP4SYA7KAT6H0/outer/inner/Engine-Validation-Evidence.md
```
