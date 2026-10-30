# 独立制品外部验证计划

服务于 [Deployment.md](Deployment.md)，不新增第四份契约。
当前仅制定计划，未运行任何外部验收检查。所有 D 项保持 unchecked。
必须等待父代理同步本契约、返回准确 deploymentRevision 并明确续派后才执行以下步骤。

## 制品与隔离

- 代码基线：`bdb498318a7840ced083ccc23d0d7e71b88c459e`；
  已接受实现提交：`a9180578f7276a16edf3c94b5470e68e4f88da84`。
  执行时记录 `git rev-parse HEAD` 作为实际打包提交，核对三个目标包相对基线没有代码变化。
  若同步带来目标包变化，先交父代理确认，不能用旧基线标签描述新代码。
- 仅打包 `@potential-guide/task-protocol`、`@potential-guide/task-engine`、
  `@potential-guide/task-engine-storage`。沿用现有 `scripts/check-packages.mjs`
  和 `scripts/check-package-consumers.mjs` 使用的包管理器打包、独立 workspace 消费方式，
  不直接运行其全仓库验收来代替本矩阵。
- 在本工作树 `.cache\terminated-outer-<唯一运行ID>` 下创建自有 `packs`、
  `consumer`、`fixtures` 和 `outputs`；不用系统临时目录或其他工作树。
  producer 是本工作树目标包的构建输出，consumer 是独立安装副本，二者不得混用。
- 计划构建命令：

  ```powershell
  pnpm exec turbo run build --force --filter=@potential-guide/task-protocol --filter=@potential-guide/task-engine --filter=@potential-guide/task-engine-storage
  ```

  对每个目标包使用
  `pnpm --dir <包目录> pack --pack-destination <自有packs目录> --json`。
  使用 Node `createHash("sha256")` 对每个 tarball 的实际字节计算摘要，
  输出 manifest JSON：包名、版本、文件名、SHA-256、字节数、代码基线、
  实际打包提交、Node/pnpm 版本、待验证 deploymentRevision。
- consumer 使用独立 `package.json` 与 `pnpm-workspace.yaml`（`packages: []`）；
  dependencies 与 overrides 均指向这三个本地 tarball，不使用 `workspace:` 或源码链接。
  以 `pnpm install --offline --ignore-scripts --no-frozen-lockfile` 安装本地制品闭包。
  若该隔离安装失败，记录真实错误，不回退到 producer 的 node_modules 或 dist。
- 消费脚本只从包名及公开 `@potential-guide/task-engine/testing` export 导入，
  可用其 MemoryStore 构造非持久测试；Clock、TaskType 和 fake work 在消费侧定义。
  不调用源码、私有方法或读取 Engine 内部事实来证明业务结果。
  记录 `import.meta.resolve` 与 realpath，断言实际模块都落在 consumer 的 node_modules 内；
  清除消费进程的 `NODE_PATH`、`NODE_OPTIONS`，避免外部模块路径或 loader 混入。

## D-S01：公开事件矩阵

后续在自有 consumer 目录生成普通 `.mjs` 验证脚本，不增加仓库源码或依赖。
固定 Clock 起点、逐步推进时钟、显式控制 prepare gate 和 StartPermit 的成功/失败，
使时间边界及先后关系可复核；独立运行 `node <消费脚本>`。
只有驱动器自身的 fake work 记录可被读取；引擎断言使用 `submit`、`getRequest`、
`getTask`、`cancelTask`、`readHistory` 等公开方法和公开超时谓词。

| 场景 | 必须观察到的公开证据 |
| --- | --- |
| start 策略的成功与失败 | start 事件时已接收的合格 Task 才获得绑定；结果保持成功/失败区别。后到 Task 不在运行中或完成后补绑。 |
| terminate 策略的成功与失败 | 运行期间无结果绑定；对应成功/失败事件出现时绑定和结算，公开历史记录同一事件时间。 |
| 生效时间与等号 | 过去请求时间保留在 getRequest，但快照锚点不早于接收；未来锚点保留。事件恰好等于锚点可匹配，deadline 恰好相等不超时。 |
| 同毫秒先后 | 不推进 Clock，分别在 start/terminate 之前及之后提交 Task；只允许事件前接收者匹配该执行，以历史 sequence 和事件类型证明顺序。 |
| prepare 尚未完成 | 另一有效 owner 提供执行时，关闭 prepare gate 的同 Input Task 仍在对应事件绑定；之后放开 gate 不覆盖结果或重复启动。 |
| 迟到成功与失败 | deadline 之后仍接受适用结果，并同时标记超时；超时需求不独自发起新执行。 |
| 多 owner 与取消 | 取消一个 owner 不回收仍有其他有效需求的执行；terminated 尚未绑定需求也保护它。被取消 Task 不接纳后来结果。 |
| 多 owner 与超时 | 一个 owner 超时不杀死其他有效需求的共享执行；超时不等于取消。最后需求取消触发自有 fake work 回收，结果与回收不是同一事实。 |
| 幂等 | 相同 requestId/意图返回相同 Task、原始请求与首次锚点，改意图明确冲突；不因晚到重试重新锚定。 |

fake work 的回收计数仅证明公开 executor 协作契约，不声称验证了真实业务 worker 的物理终止。
实际进程退出与 SQLite 恢复由下一组独立进程场景证明。

## D-S02：独立进程与拒绝边界

- 由消费侧控制器启动独立 Node 子进程 A 写入自有 SQLite，输出收到的原请求、
  公开快照与历史；A 完整退出后由独立进程 B 打开同一路径。
  进程间只传 JSON、公开身份与 fixture 路径，不共享引擎实例。
- 分别覆盖可靠成功、可靠失败及只有 start 没有可靠终结事实。
  可靠结果在重启后保持身份、执行关联和事实时间；不确定执行恢复为
  `execution_interrupted`，已接收且满足终结规则的需求可在恢复失败事件绑定，
  不重新执行业务。通过消费侧 execute 调用计数和公开历史证明，不读取内部状态。
  用进程 A 的原请求在 B 幂等重试，核对 receivedAt、eligibleAt、deadlineAt 未重新锚定。
- 通过制品公开 `submit` 提交 `completed-after-eligible`，断言明确报错，
  且不存在静默别名或被接受的 Task。
- 仅使用自建旧格式夹具：非空 version 0、version 1、未知版本；
  另从自建 v2 夹具构造旧 checkpoint/Facts，覆盖已有 WAL 的拒绝。
  `node:sqlite` 仅用于夹具构造/设置存储版本，不用于代替引擎业务结果断言。
  新制品 `openSqliteStore` 必须拒绝，并提示另用新存储。
- 对每次拒绝前后枚举 fixture 目录，对主库及存在的 `-wal`、`-shm`、`.owner`
  逐文件计算 SHA-256 和字节数，断言文件集合与内容均未变化。
  有活动 WAL 的自有 writer 保持打开直至比较完成，避免把 fixture 自身关闭动作
  造成的 checkpoint 当作被测行为；随后再关闭它。
  同时证明没有残留 `.inspect-*` 文件，不触碰任何实际旧库。

## 持久证据、失败与清理

- 消费侧输出逐场景 JSON：固定输入/时钟、预期、实际公开快照/事件、
  断言结果、进程退出码；失败必须保留错误，不将未完成算通过。
  记录实际生成的消费脚本 SHA-256、完整运行命令和制品 manifest，
  在 `outer\Verification.md` 保存可复核摘要及关键公开输出。
  若证据较多，可放同世界 `outer\evidence` 的 JSON 支持文件，不放入 Inner。
- 脚本为本工作树自有临时验证材料；执行后保存摘要证据，再清理脚本、安装目录、
  tarball 副本及 fixture。没有 npm 发布、全局安装、生产迁移或真实旧数据删除。
- 控制器对每个自有子进程设置超时，使用已保存的进程句柄/PID终止和等待，
  不使用按进程名清理。finally 中关闭引擎/存储/fixture writer，等待子进程退出，
  只删除本轮唯一运行目录，并记录“目录不存在、无自有活动进程”的清理证据。
- 若发现制品缺陷，停止并向父代理报告，不在部署阶段修改源码或已接受的 Inner。
  只有所有外部断言及清理证据满足时才勾选对应 D 项；父代理负责同步、
  submitOuter 与受委托的精确 revision 审查，Agent 不宣称已验收。
