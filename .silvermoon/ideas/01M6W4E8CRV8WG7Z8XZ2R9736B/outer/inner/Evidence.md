# Probe Task Bundle 实施证据

## 结论与边界

I-S01～I-S03、I-AC01～I-AC03 的实现和仓库内验证已完成。
没有新增业务编译器，没有修改通用 Engine，没有直接加载子 `worker.cjs`。
没有修改 Ideal、Deployment 或事件历史，没有上传、pin、发布 npm、提交或推送。
外部交付及其验收仍由 Outer 阶段负责。

## 两阶段与内容身份

- `packages/probe-sdk/src/authoring.ts` 提供 `prepareProbe`、`verifyProbeResources`。
  第一阶段快照作者源、页面、显式附加资源和已验证 Check 内容，生成 definitions、
  `resources/objective.json`、精确 `task.build.yaml` 与根外 `prepare.lock.json`。
  不编译 Worker，不在准备阶段生成最终 Probe CAR。
- 第二阶段仍调用现有 `@potential-guide/pguide-task-bundle` 的 `buildTask`。
  本次没有修改该编译器；它支持的规范 UnixFS 参数足以保持已接受规范子树的 CID。
- `packages/ipfs-content/src/tree.ts` 使用官方 Helia/IPLD 内容接口获取完整树，
  验证块、路径、文件/字节/块预算和取消。重新计算规范根必须等于输入根；
  相同文件但使用不同 UnixFS 导入参数的内容明确拒绝。
- 接受器读取最终 CAR 的真实闭包，比较传入文件快照与 CAR、完整资源集、精确
  binary、结果契约和每个 `resources/checks/<binding>` 的实际目录 CID。
  不是只比较复制前后的文件内容，也不信任 JSON 中的 CID 声明。
- 父 binary 是父自选项与带前缀的原子 binary 的精确并集。
  父资源映射和 binary glob 不能选择/覆盖子树；子文本已通过通用规范验证，
  父编译中的文本规范化不会改变它。
- 锁记录作者输入散列、来源、精确 CID、publication revision、Node 版本、
  规范 UnixFS 策略与依赖锁文件散列。锁定模式不查询 publication，
  来源、作者或工具链锁不匹配即失败。不同快照使用不同 staging 目录；
  接受的制品/索引由调用方在所有验证通过后更新。

## 文档、格式与兼容性

- Check 与 Probe 共用 `check-sdk/authoring.readReferences`、路径/文件验证和
  Reference frontmatter 验证；不扫描任意 Markdown 链接。
- Check 作者 Schema 拒绝旧 `references`；仓库四个作者 YAML、作者测试、
  作者文档、environment 接受测试及 binary 缓存输入推导已迁移。
  生成的 Check `resources/check.json.references` 和结果协议保持不变。
- Probe 从语言和阶段推导 objective、全部业务阶段及 terminal 页面；
  仅发现已知逻辑引用、已声明 Problem 的稀疏覆盖页。
  不存在的合法可选覆盖继承同语言子页；已发现但无效的页面失败。
  可用完整覆盖补充子 Check 不支持的语言，不进行跨语言回退。
- 输入映射为有界 own-property 点路径或 `$`，最多 32 段/1024 字符；
  禁止原型路径、缺失值、动态表达式和 IO。
- 新 Schema 位于 `schemas/artifacts/check-build/v2.json`、
  `probe-build/v1.json`、`probe-objective/v1.json`，由既有 Schema 同步脚本生成。
  旧 Objective Schema、旧 attained-Level 运行时及不可变制品未改写。
- 新 Probe SDK 与现有 ipfs-content 均保持 private workspace 包；
  已纳入本地 pack 验证，但没有注册 npm 发布入口。这不影响生成标准 Probe CAR。

## 独立 Check 执行

`packages/probe-sdk/src/index.ts` 与 `execution.ts` 分别承担业务装配及显式子调用：

1. Probe 从 `context.bundle.cid/read` 获取身份及业务 JSON，不使用 cwd 或
   假定 SDK 有嵌套执行接口。装配结果时不读取 Markdown。
2. `createCheckInvoker` 接收调用方明确提供的 TaskService/HTTP TaskClient、
   IPFS client、身份、超时及授权函数。既检查允许的父/子 CID 和 scope，
   又从父 DAG 验证实际子目录 CID，再提交该 CID 为独立 Task。
3. 子输入和结果经过独立 Engine 契约校验；Probe 再验证原 Check 事实和完整
   原始文档身份。Task envelope 冲突、错误根、映射或非法结果均为调用错误。
4. 父取消/截止 AbortSignal 以及独立子超时会取消子 Task。
   admission 是持久请求：submit 或 preparing 状态查询的响应丢失/失败，
   以及取消之后，均按原 requestId 恢复接纳决定，再取消已接纳 Task；
   不重提请求。清理拥有独立预算，从失败起默认/最多 30 秒，
   `cleanupTimeoutMs` 可缩小；每次状态查询和取消 await 都受此预算约束。
   HTTP transport 仍必须有自己的请求预算。永久不可用明确返回清理未确认，
   保留 requestId 供后续授权恢复，不把“未查到结果”当成“子 Task 没有创建”。
   不承诺跨进程强杀后仍存在没有外部监督者的无限期清理。
5. `CheckInvocationCleanupError` 的 cause 和首个 errors 成员保留原始失败，
   另保存有界清理错误样本、错误总数及 cleanupConfirmed。正常清理成功时重抛原错误；
   清理中的暂时错误即使后来恢复也不会被静默丢弃。错误摘要包含原始消息，
   经通用 Worker 错误通道传递时仍能看到失败原因和清理结论。
6. 子调用适配器返回 unknown；Probe 在访问字段之前使用真正的 Check Schema 验证，
   不再通过双重类型断言宣称结果有效。业务 JSON reader 的 cancel/releaseLock
   错误也会报告；同时发生读取与清理失败时保留原错误作为 AggregateError cause。
7. 空阶段自动推进；首个失败阶段聚合所有失败 Check、排除通过项。
   全通过返回真实 terminal 及空 checks。每个结果节点提供完整语言 URI，
   覆盖仅作用于逻辑引用，不改变原 Check 事实。

运行环境、授权 transport 与凭据交付属于部署装配。测试使用仅限 fixture 的
本地 HTTP capability；生产凭据不应固化到 Worker、业务资源或持久 Task 输入中。
内容自包含不意味着运行环境或授权设施自包含。

## Publication 的真实 API 核实

2026-11-08 只读调用 Pinboard `publication_get`，公共响应为：

- publication ID：`ddb3a646-8353-4531-9b10-9d4ee7bb9751`
- `currentRevision = current.revision = 1`
- `current.cid = bafybeieqcbsrb4xfnstoc5fmlhhjefyylpgruk4nfgk36kcuxf2mj6xota`

使用 `https://pinboard.shazhou.work` raw gateway 与官方内容工具读取该根，
证明它是含 `task.yaml`、Worker、schemas、Check 资源的 11 文件目录，
不是页面或 CAR 文件 CID。这个历史目录没有当前 Task 规范要求的显式 binary，
因此业务准备明确拒绝；未悄悄迁移、更新 publication 或替换其身份。

另外只读验证已有当前 tools Check：
`bafybeifydrqggqypfapxiwt2bpovdprxae6iysrjhiua3d2jebico74u7a`，
11 文件，`kind: tools`、`languages: [en]`，
Problem codes 为 tool-missing、tool-unusable、version-unparseable、tool-version；
完整当前 Task/Check 验证通过。

`createPinboardResolver` 使用上述真实公共 metadata 结构。
`https://<origin>/publications/<id>` 是作者 locator，transport 显式调用
`publication_get({id})`；不把 locator 的页面 URL 猜成 HTTP JSON 接口。
匹配当前规范的完整 publication→Check→Probe 成功路径由控制 fixture 验证，
并验证共享来源只解析一次、锁定不重解析、未授权 origin 和错误内容类型失败。
本阶段没有创建/更新任何外部 publication；实际最新发布指针的交付由 Outer 决定。

## 可重复的验证证据

主要测试：

- `packages/probe-sdk/test/probe.test.ts`：7 项全部通过。覆盖配对作者格式、
  publication/lock、语言补全、未知/无效页面、失败阶段聚合、后续阶段、
  terminal、只读 JSON 装配，以及标准 Engine 的真实 HTTP 父子执行。
  同时验证权限拒绝、错误子根、非法子输入、执行错误、父取消、父截止和子超时。
  新增 reader 读取/清理同时失败及成功读取后清理失败的断言，并验证 reader 最终解锁。
- `packages/probe-sdk/test/execution.test.ts`：7 项（含 2 个子场景）全部通过。
  控制的持久接纳服务先保存请求，再丢失 submit 响应；状态查询暂时失败、
  父信号已取消时，仍使用唯一原 requestId 恢复并取消。
  同时覆盖 preparing 查询失败、取消响应丢失后重试、永久拒绝及永不完成的
  状态查询（60 ms 清理预算）、unknown 结果边界。原始错误与清理错误均有身份断言。
- 其中最终 CAR 测试包含跨 UnixFS chunk 边界的 270,000 字节二进制，
  比较父 include/binary、所有子文件和实际子目录根；仅用父 CAR 离线恢复，
  目录物化后复验；同一准备快照二次构建 CID 相同。
- `packages/ipfs-content/test/tree.test.ts`：规范快照的文件/路径/字节/块预算、
  缺块、取消，以及不同 UnixFS 导入参数拒绝测试通过。
- `packages/check-sdk/test/sdk.test.ts`：9 项通过。
  Environment 接受、失败保留旧输出和真实 Git/Turbo binary 缓存回归也通过。

完整标准命令 **`pnpm check` 最终退出码 0**：

- WSL Ubuntu，Node **24.14.1**，pnpm **11.22.0**；
- workspace build/test 图 **70/70 successful**；
- 根 scripts 测试 **77/77 pass，0 fail**；
- Schema、格式、lint、类型检查、包分层及所有 package structure 检查通过；
- Probe 和 ipfs-content 均已进入 pack 验证；评审修复后的 Probe 总计 **14/14 pass**；
- 沿用原有平台限定测试条件，没有添加 skip、成功兜底或降低验收门槛。

验证环境恢复过程：

1. Windows 以项目 `.cache/pnpm-store` 恢复依赖，未删除/修复共享
   `D:\.pnpm-store\v11`，未改全局配置。
2. Windows 完整检查进入测试后遭遇既有文件符号链接 `EPERM`。
   WSL 普通 DrvFS 和带 metadata 的专用挂载仍不具备全部 POSIX unlink/inode 语义。
3. 在工作树内创建专用 ext4 镜像并挂载为隔离候选副本；
   全部文件、依赖缓存及验证日志仍在工作树内。
   用 `pnpm_config_store_dir` 进程变量指定健康局部 store，
   排除 Windows PATH 中的已安装同名 CLI，随后完整检查通过。
4. 逐文件 SHA-256 比较确认验证副本与候选代码一致。
   首轮检查设施已清理；本次按父级要求保留另一个已卸载的专用镜像，
   没有遗留 server/helper。34 个候选代码/Schema/包配置文件比较无差异；
   精确复跑命令及环境归属见 [验证环境复用](Validation.md)。

首轮完整检查日志为未提交的 `.cache/probe-native-full-check.log`，
其 SHA-256（父级已核对）：
`16fad2499d5c6bb79d9a9a3d0b717f8f3d39a6ba52308ea318c54e7efa3b9edb`。
评审修复后的最终完整检查日志为 `.cache/probe-review-full-check.log`，
退出码 0，SHA-256：
`dd387c591014753ce31c1dcb21d11ebce72a3c1dccb6757cc205cc8ec704a9c5`。
日志只是本地诊断副本；上述可运行测试与本文件是持久评审证据。
