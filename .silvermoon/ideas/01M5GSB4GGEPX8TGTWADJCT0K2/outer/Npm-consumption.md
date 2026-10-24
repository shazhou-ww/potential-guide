# npm Pilot 固定版本部署消费（2026-10-24）

## 准确候选与执行边界

用户明确授权父 Agent 负责门禁检查与 approval、自行决定。父 Agent 在独立
Windows 全仓检查、Linux 干净源码构建与安装消费通过后，接受准确实施
`2a3451bf934c7f2da0810c5cd0d53cba753161e4`；事件已同步 primary。
本阶段不改产品交付物，不修改 Ideal/Implementation，不执行 npm publish、tag 或生产操作。

消费固定提交 `bb8055e0728c8b4b018419c4f65903e8fe94d38b` 的 Git archive，
在专属目录 `D:\Code\npm-pilot-deployment-20261024` 独立安装、构建、打包。
不是复制当前工作区 dist，也不依赖工作区 node_modules。
准确 archive SHA-256、24 个 tarball 的版本与摘要、六个 npm Objective 身份/digest、
十六个 check artifact revision 和 Coordinator 重放结果记录在
[Npm-consumption-inventory.json](./Npm-consumption-inventory.json)。

环境为 Windows / Node v24.12.0 / pnpm 11.22.0。
独立 source archive 的 build 与 pack:check 均 exit 0：
24 包、11 个隔离安装场景通过；npm-objectives 场景 15 selected/24 internal。
沿实际父依赖检查真实路径与版本，运行模块只在 consumer 内解析。
测试 runner 可以来自固定 source 的开发工具；产品 Host/CLI/runtime 则来自实际安装包。

原有 [Consumption.md](./Consumption.md) 的超时、native assertion 与热态失败记录保持不变，
本轮结果只针对新实现的准确包内容；不回写旧失败为成功。

## D-S01 / D-AC01：真实安装消费

独立构建得到的六包各自只有一个根 objective.yaml、名字取实际 package.json.name；
安装副本再经 npm 标准 packlist 准备并与原准确 tarball 的完整包 digest 比较一致。
References、worker、Wasm/资源均位于其包，pnpm 硬链接仅在私有准备副本中解除，
不修改安装源、不放宽 Host 单硬链或完整内容检查。

| 验证面 | 本轮结果 |
| --- | --- |
| 全部六包十六入口 | 从实际安装树准备；全部 16 个入口进入执行，错误 Subject 为真实业务/调用拒绝，不是模块加载或初始化故障 |
| 真实 monorepo 根/包依赖 | 根 check 释放执行资源，上层准备并观察独立 package-standard，再重查根并达到 standardized；记录两个真实 npm 包来源 |
| Coordinator 身份与恢复 | Objective 仅保存 packageName，Revision 保存包 digest，无伪造 commit；6 条真实 reducer 事件重放与查询视图一致 |
| 包来源与冻结 | 实施阶段的真实本地 registry version/range/tag/alias、远程 tarball、Git 与目录准备及离线恢复，在 Windows/Linux 两平台各 16/16 回归通过；本阶段固定安装与包摘要复算再次通过 |
| 多 CLI 复用 | 实际安装 CLI 七次共享同一经认证 Host，始终只初始化 2 个真实 worker；与三次新服务作同输入比较 |
| 旧来源/格式 | 旧 Git commit/tree 仍是历史来源，不被冒充包 digest；仅有旧 run.mjs 的运行产物在消费验证中明确拒绝 |

包源/脚本授权的网络模拟只使用操作拥有的本地 registry/Git fixture，
未向真实 registry 发布或申请权限；源码准备与运行分离，单次 check 不安装/构建。
宿主授权、外部解释器/平台能力不由包 digest 证明。

## D-S02 / D-AC02：实际失败边界和资源

复制固定提交的既有 Host 测试到已安装 Host 包旁，保留 ../dist 指向其安装产物，
仅将真实 package-standard fixture 路径改为该 tarball 的已校验不可变 capsule。
所有断言与默认预算保持不变，不使用 workspace runtime 替代。

- 安装包 Host suite：33 项，31 pass、2 实际 POSIX 专属 skip、0 fail。
  包含实际 Windows owner/protected ACL、宽权限拒绝、权限后端失败、
  独立发布竞争、六轮 startup/published 崩溃恢复、更新排空、取消、清理与退役/预热。
- 八次全新真实 worker 快照在 startup 中关闭，线程/队列/ownedProcesses 归零，
  未突破原 cleanupMs；无 native handle assertion。真实冷 check 进入执行，
  未改变默认 5 秒初始化预算。
- 512 次混合任务为 Completed 448 / Failed 32 / Cancelled 32，
  peakWorkers=2、peakRecords=16；末批 records/queue/ownedProcesses=0，
  close 后继续断言 workers/records=0。RSS 样本 186.89→185.36 MiB；
  不将有限负载与短时 RSS 当作无限期无泄漏证明。
- 实际 HTTP 代理向 client 转发当前帧后结束流：client 明确报 unknown after disconnect，
  原执行仍 Running、executions=1；再次观察同一 ID 不重复执行。
- cancel 的受理/Cancelling 不当作终态；继续观察到 Cancelled 确认清理，
  保留期后 404 且不重跑。活动集合不含 Subject，未认证读取返回 401。
- 旧冷文件加载路径改为 worker 执行已验证入口字节，资源仍来自准确不可变快照。
  以上确认新路径的行为回归，不声称定位或修复了 Node 内部 native assertion 的所有原因。

Linux 使用同一运行代码的 source-only 候选 archive 独立构建，
Host suite 31 pass/2 Windows skip、npm 来源 16/16、24 包/11 场景隔离消费通过。
该补充证明实际 UID/mode/进程锁及来源路径，不假称本轮 Windows 安装消费直接验证了 Linux；
详细平台和候选树见实施证据，Windows 全仓 pnpm check 仍是独立必需门禁且已通过。

## 实际安装 CLI 冷热比较

在上述安装包 Host suite 结束后，无并行测试负载时运行固定提交的 measurement 脚本；
仅适配 Host、CLI、Pilot 的路径到 consumer，保留原断言、调用次数和 60 秒外层上限。
源码 fixture、Subject、依赖与包准备流程不缩减，不以增大初始化预算换取通过。

Subject 267 字节；实际消费包 revision：
`sha256-pguide-package-v1:ceb529b5204b0ff55047973e12d33d48ee75444c94a84c6b64ea775055713d31`。
该包 digest 与实施测量样本不同，两次独立构建不视为同字节包，不对差异作未经测量的归因，
也不将其 digest 或跨轮时延混比；本轮安装树与本轮准确 tarball 的摘要一致性已实际验证。

| 观测 | 实际安装结果 |
| --- | --- |
| shared cold 完整 CLI | 10402.80 ms |
| 完整 CLI 每次新服务，3 次 | median 10080.20 ms |
| shared hot 完整 CLI，6 次 | median 7052.73 ms |
| cold 服务 RSS / private bytes | 273.59 / 290.50 MiB，包含实际权限 helper |
| shared worker 初始化 | 七次 CLI 始终为 2，没有逐请求重建 |
| 短时 RSS guard | 2×cold = 547.18 MiB，通过；不是泄漏 SLA |

证明的是同轮、同一固定包/Subject 下复用相对新服务的收益，不将单 checker 与完整 CLI
比较，也不外推成所有网络、registry、环境下的时延保证。

## 门禁和保全

D-S01/D-S02/D-AC01/D-AC02 均有当前外部消费证据，ledger 勾选只记录 Agent 完成。
先验证并同步这份候选，再 submitOuter；随后由父 Agent 根据用户的明确委托，
对准确的已提交 deployment revision 作出批准决定，不跳过任何 submit/检查步骤。
原始 build/pack/test/测量日志、固定复验 harness 和准确 inventory 保存于会话资料；
不提交 bearer token、descriptor、运行 PID 或安装缓存到 Git。
临时环境仅在核对 PID 归属、服务已退出及证据保全后清理；没有 registry 发布。
