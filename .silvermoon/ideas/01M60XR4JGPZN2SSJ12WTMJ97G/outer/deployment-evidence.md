# 独立 Host v2 部署证据

## 契约与范围

验证基于已接受的 inner `d1d690f76c5516b961f6247c08473699a08cdc4a`，
仅修改本 outer 的契约、验证脚本与证据。实现源码、Ideal、其他 idea 不变。
真实验证前同步契约/脚本到 primary；每次执行 receipt 记录当时的 primary、
deploymentRevision、Deployment.md blob 与脚本 SHA-256。当前完成依据见下方最终验证，
并非 lifecycle acceptance。

## 执行与修正

首次执行 `node .silvermoon\ideas\01M60XR4JGPZN2SSJ12WTMJ97G\outer\verify-deployment.mjs`
在已同步 baseline `b7aaf02536986d21f95d681e17df6b699b00a136`、
outer `c3cdc4d1e7914884bb5af55375b08b9cf94b8764` 上运行。
准备阶段发现 packages 下有已退休但残留缓存的目录，没有 package.json。
这不是交付实现错误：验证器须仅枚举真实 workspace，现只对 ENOENT 跳过非 workspace；
其他读取/解析失败仍明确失败。此次未安装工具、未启动 Host，操作拥有目录已删除，
没有遗留服务。原始失败 receipt 位于操作 `.cache`，
不以此冒充任何 D 验收通过。

第二次在已同步 baseline `9d217fecbdefe2fd1c9b38d032c11bc3fd1f4f17` 上实际离线安装
10 个本地工具包及其依赖，安装退出 0。消费者完成前面的真实 Host/版本/事件/生命周期
断言，进入 Pilot 时正确返回 502：本 outer 新作者样例遗漏了业务 problem 必需的
`kind: internal`。这是作者 fixture 的业务 envelope 不合法，不是已接受实现错误；
按公开 Check 契约补齐该字段，未修改 inner 或实现源码。
操作目录、HTTPS 作者服务、Host/kernel/helper 均经 finally 清理；此失败不计 D 完成。
验证器同时补保存脱敏 partial consumer receipt，以便失败也能定位已执行场景。

第三次在已同步 baseline `4b5cb9738c436d13d28c266eaf11ab3965d4c85e` 上，外部 consumer
已完成全部 10 个场景且保存结果、清理服务，但新增失败包装器的变量被误置于 SSE helper
局部作用域，最终以 ReferenceError 退出 1。此为 outer 验证脚本错误；将失败变量移至
模块作用域，保持所有断言与清理不变。此轮退出不为 0，仍不勾选 D，继续完整外部复验。

第四次在已同步 baseline `9b95359e7fd57f7fe002832ab93d20d38a216ba1`、
outer `4fd274a27bf78e474da62e452c919f8fe1876cc3` 上完整退出 0：
10 个工具离线安装、10 个真实场景通过，协作清理约 12.3ms，墙钟封口约 3045.2ms，
物理回收约 6296.6ms，最后服务关闭、worker/子进程归零、外部目录删除。
原始 receipt SHA-256 为 `e8832f8a22376d509b17c6b72aaa2cf4753d8bed1265710cba754de1a09962ae`。
为让单对象 `task.events()` 的公开调用也独立可见，增加终态读取断言（此前已由 result
内部消费同一方法）；不增加重复场景，按新稳定脚本再完整复验后才提交最终 D 证据。

## 最终独立验证

完整命令：

```powershell
node .silvermoon\ideas\01M60XR4JGPZN2SSJ12WTMJ97G\outer\verify-deployment.mjs
```

最终运行退出 **0**，**10/10 场景通过，无跳过**。详见
[脱敏原始 receipt](./deployment-receipt.json)，SHA-256：
`3de20e0c0f3ea497218b6294dc563756868ac98010ab0f3cb4e655fd42f77af5`。

验证基线已先同步到 primary：
`6c0b8bb81fff1b2392ab95412a80874999cab480`，
当时 outer revision `39c87f0d1c77be53050fadfcc1c400c40fbde83d`；
稳定 Deployment.md blob `bae4eb4f47bda7fecd69f374c9b744e4df9fb2de`。
执行后只添加本证据与 receipt、勾选 ledger，契约与验证脚本不再改变。

### 安装与执行面

- Windows、Node **24.11.1**；在仓库同级随机新建操作目录，以受保护 ACL 和 owner marker
  约束所有文件及清理。消费者不在源码工作树内。
- 显式构建已接受工具，再 pack **10 个真实内部包**。使用
  `pnpm install --offline --ignore-scripts --no-frozen-lockfile --store-dir <existing-store-parent> --reporter=append-only`
  安装，退出 **0**。无在线兜底，无安装脚本；每个包的版本、tarball SHA-256、尺寸和文件数
  在 receipt 的 `tools` 中。Host tarball SHA-256：
  `25bd753b6d88d1c61f5a8b50a916ceaaaec3769c747647eae249279d90cfdbbe`。
- 作者独立进程使用安装后的 `@potential-guide/check-artifacts/build` 公开 API 显式 build/pack。
  消费者仅按公开包名 import；**10/10 模块 realpath 位于外部目录**，不在 checkout，
  没有源码链接、NODE_PATH、NODE_OPTIONS、loader 或 test hook。
  普通消费者只提交 URL/可选 digest；Pilot 缓存只有 Objective 数据，没有 Check 物化。
- 受控发布者是正常 TLS HTTPS 服务；使用本操作显式 CA 信任。移除 CA 的独立请求实际失败，
  没有关闭 TLS 校验。私钥、token、私有 Host 路径和签名查询未保存于 receipt。

### 真实场景与可观察断言

| 场景 | 实际证明 |
|---|---|
| ready/auth | 真正 v2 HTTP 返回准确不存在错误，未带 token 的请求 401；确认可响应后才创建 Task |
| SDK JSON | NaN、getter 本地拒绝，HTTP 计数不变，getter 调用零 |
| 排队共享/版本并存 | 初始化文件 gate 保证两个强 Task 已 waiting、execution 计数仍 0；释放后共享一执行。V2 仍处于代码 gate 时 URL 切 V3，两份内容同时进入代码，身份不合并 |
| 单/多事件与重连 | 显式 `task.events()`、`watchTasks`、统一 `events?taskId=a&taskId=b` 的终态初始读取；两次新连接的 revision 相同，重复读取未增加执行。状态历史 revision 严格递增 |
| 固定旧版 | latest 已为 V3，URL+V2 digest 仍取得 V2 与原始 V2 Reference |
| freshness/独立需求 | 在独立 entered 记录之后受理 weak，关联旧执行；strong 创建另一执行。取消原 Task、500ms 独立总期限超时后，weak 仍 running 且没有提前清理记录 |
| 最后需求取消 | 单独协作 Task 取消后观察 aborted cleanup 记录，约 **13.7ms** |
| 执行墙钟/强杀/隔离 | 失控 worker 真正启动子进程并阻塞，健康 worker 正常完成；后加入 weak 观察未延长原墙钟。约 **3029.5ms** 先封口失败，约 **6331.5ms** 后确认子进程不存在且只有健康 worker，再用健康 worker 成功运行后继 Task |
| Pilot/regulator | 安装的公开 API 消费固定 HTTPS Check，业务未达标正常返回，regulator 达到 ready 且不调用 Agent；Reference 保持 owning digest。三条真实 host-observation 有 taskId/executionId/digest/revision |
| 准确恢复 | 同 URL 发布仅 References 改变的新逻辑内容（execution revision 相同），并移走作者 Objective；依赖冻结 source/已验证缓存恢复仍使用原 digest/revision，而非隐式 latest |

共 **12 个 Execution、4 次 worker 初始化、峰值 2 worker**；Task 身份与物理执行分别记录。
20 次事件连接包含过滤列表重建、显式重连、裸协议及业务独立 Client，不是同时启动 20 条 SDK
流。作者记录 V2 两次浮动来源确认、V3 一次；固定 V2 后续请求没有追加 V2 下载。
准入 Task timeout 与物理 cleanup 在不同观察点分别核验，没有把 cancelled/failed 当作退出证明。

### 制品准确身份

| 内容 | Logical digest |
|---|---|
| V2 | `sha256-pguide-check-v1:70f4883017d6f4ff8934edd5b2679b4cc8a053e5a78a4c3d2524502675c6889f` |
| V3 | `sha256-pguide-check-v1:2a047d5cabf5e31c2951c113f53a4b957bf4886a6660f327ac87ea60d30dc5c5` |
| 固定业务 Check | `sha256-pguide-check-v1:ea34f1d8a24859a479fbe34f48d791f5b332cb47e430e5ad174d44db4dd5bb4c` |
| 仅 Reference 更新 | `sha256-pguide-check-v1:dda3781f2e546498814f7912adee0a57bc50fa159bde34e3f75cc0e560d7df25` |
| Objective | `sha256-pguide-objective-v1:69b90e4164b0ec3593481bb52609d187abec100b9a4a2315b266fb4489d92f19` |

每份 archive 的 transport digest、实际 execution revision 和工具 digest 见 receipt。
受控 gate 资源与 Objective URL 含本次随机目录/端口，因此重跑的实验制品 digest 可改变；
这是显式作者输入差异，不是缓存漂移。业务固定 Check 的内容与原始 Reference 在恢复中未改变。

### 清理与剩余范围

最终 `serverClosed=true`、`workers=0`、`ownedProcesses=0`、
`permissionHelperClosed=true`；作者 HTTPS 关闭，所有操作拥有的证书、私钥、
工具安装目录和 marker 目录删除，`noPersistentService=true`。
清理只针对本操作标记匹配的目录和已启动进程，不扫描或终止其他服务。

仅本机受信调用方、Windows/Node24、受控 HTTPS 发布者已实测；不声称 Linux/Node22、
任意 GitHub 网络、发行者签名或恶意 Check sandbox。依赖的离线 store 需预先备妥；
第一版仍有公开的容量/保留界限，不承诺跨重启 Task exactly-once 或无限历史检索。
v1 是短期显式兼容，不能观察/取消 managed v2 Execution。

已接受 inner/ideal 与实现源码均保持不变；late-resolution 等纯状态机性质引用
[已接受 inner 证据](./inner/verification.md)，没有伪造为外部实测。
没有 npm/GitHub Release，没有推进 release idea；本次只提交准确 outer revision 待主会话审查。
