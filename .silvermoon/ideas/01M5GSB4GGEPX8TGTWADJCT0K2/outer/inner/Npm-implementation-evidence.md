# npm Pilot 实施证据（2026-10-24）

## 来源与职责

Ideal `5764287733d2207a4a2c3dbe77462164ad4b7d25` 经用户明确接受，
`acceptIdeal` 在 `5b4c2d307d8dd933ba0b340b89a31a297782e8a4` 同步 primary。
用户授权 subagent 实施、父 Agent 独立验证并自行作出门禁决定；不包含 registry 发布。
subagent 因模型请求重试失败而中断，没有可用的最终交接；父 Agent 保留其改动并接手，
不以工具调用数、运行时间或文件改动量代替完成证据。

## 候选与覆盖

- 六个实际 npm 包各有一个根 objective.yaml；独立拆出
  `@potential-guide/objective-package-standard` 与 `@potential-guide/objective-setup-marker`。
  package.json.name 是身份，多个 check 不产生子 Objective 名称。
- npm-package-arg、pacote、Arborist 处理标准来源；准备阶段显式授权脚本，
  package spec、resolved、integrity、版本/commit 保留为来源，而非内容身份。
- 包 digest 为 `sha256-pguide-package-v1:` 加 SHA-256，规范编码与固定执行位测试向量
  已实现；覆盖全部交付文件，重打包和目录移动不改摘要，内容/执行位改变则摘要改变。
- 版本固定贯穿 CLI、声明、依赖结果、regulation/supervision、Coordinator
  请求/事件/持久化重放/视图。continue 不重新解析浮动来源，旧 Git 记录保留原有含义。
- 生成 runtime、worker 和资源副本从 Git 源码移出；构建输出到忽略的 .staging，
  组装到各包 dist/package，以实际 pnpm pack 内容验证交付。
- Host 继续接受 check 目录与其独立产物 hash。准备端私有物化、单硬链接校验未放宽；
  Wasm 与受管异步子进程有运行回归，同步子进程因无法确认取消而明确拒绝。

## 接手后修复与原失败保留

首次父 Agent 全量检查：构建/lint/类型检查与 Turbo 48/48 通过，
root tests 中六项证据 fixture 仍指向被迁出的 runtime/checks，全部失败。
修正为实际 dist/package 或 .staging 资源后，六项独立重跑通过，没有删除其证据断言。

实际安装消费随后卡在 pacote 本地目录打包。父 Agent 分离 Arborist/packlist 与 tar 操作：
前两者正常，node-tar 7.5.22 对 pnpm 安装目录的跨子目录硬链接稳定死锁；
包 fetch 已握手但 archive 保持零字节。对应上游问题
[isaacs/node-tar#460](https://github.com/isaacs/node-tar/issues/460)，该版本仍为当时 latest。
未降级到有已知漏洞的版本，也未改写 node_modules 或放宽 Host 校验。

修复为使用 npm 自身 packlist，在已授权 prepare 后复制清单内普通文件到私有 staging，
保留执行位，再交给 pacote 打包；caller 源文件/硬链接不变。归属与来源仍记录原目录，
临时复制树不进入包 digest，成功后清理；异常由父准备作用域清理。
新增跨目录 hardlink 回归在原 5 秒测试期限内通过，准备后文件 nlink=1，
源文件 nlink=2，字节相同。对脚本授权与取消的既有测试仍通过。

安装消费 fixture 另有两个错误：Coordinator 未经 run-phase running 就发布 observation，
以及把内部 pguide-check-host 守护进程当普通业务 CLI 运行 --help。
补齐真实 reducer 状态转移，仅对业务 CLI 断言 JSON help；Host 的安装 shim 必须存在，
实际 Host 生命周期由专门测试与消费验证，不新增守护进程业务命令。

一次 Windows 全量复验出现 workload.test.ts 文件级失败，无具体 JS 断言；
独立同文件 2/2 通过，保留该失败，不认定已查明其原因或将它冒充为旧 native assertion。

## 验证入口与当前结果

Windows 为 Node v24.12.0 / pnpm 11.22.0，Linux 为 Ubuntu/WSL2
Node v24.14.1 / pnpm 11.22.0。Linux 使用准确候选树
`e924c4bfe9f3031e4ba6d9c2b0b1606f49405527` 的 archive、新建专属目录、独立依赖和构建，
不使用 Windows node_modules；该树不包含入库 bundle。

| 项目 | 结果 |
| --- | --- |
| npm resolver 定向测试 | Windows 与 Linux 各 16/16 pass，含真实本地 registry version/range/tag/alias、远程 tarball、Git、目录、固定离线恢复与冲突拒绝 |
| digest 规范向量 | 两平台均验证确定 SHA-256、重打包/位置一致、内容与执行位变化；unsafe archive 在提取前拒绝 |
| Linux Host suite | 33 项：31 pass、2 Windows 专属 skip、0 fail |
| Linux 干净构建与 pack:check | exit 0；24 包、11 隔离场景通过，npm-objectives 场景 15 selected/24 internal |
| 实际安装 npm-objectives 消费 | 六包十六入口从实际安装树准备，比较原 tarball 摘要，真实 root/package 依赖完成，Coordinator 持久化/replay/views 一致 |
| 根证据 fixture 修复 | 父 Agent 定向 6/6 pass |
| Windows 最终 `pnpm check` | exit 0：layers/format/lint/typecheck、Turbo 48/48、root tests 35/35、24 包/11 隔离场景全部通过 |

Linux 此处不是全仓 pnpm check 的替代；Windows 最终完整检查由父 Agent 运行并保留独立日志，
不是沿用 subagent 的未完成结果。生成的测试/打包路径与内部 Host shim 探测问题均已修复。
原先 Windows workload 文件级失败独立复测及最终全仓重跑均通过，历史原因仍未确定，
不把一次通过解释为无限期稳定性证明。

I-S01/I-S02/I-S03 和 I-AC01/I-AC02/I-AC03 现有完成证据，ledger 可记录 Agent 完成；
仍需同步候选、准确 submitInner 后由父 Agent 根据用户委托作出实施门禁决定。
本节不自行记录 lifecycle acceptance，D-* 在部署阶段另行验证。

## 冷初始化与启动中退出

Host 不再对刚写入的不可变 worker 快照进行第二次冷文件模块加载；
父内核将已经校验的入口字节传给 worker，用 CommonJS 编译封装执行，
资源路径仍指向同一不可变快照。没有降低完整内容校验，也没有增加默认 5 秒初始化额度。
模块 metadata/shebang、顶层 exports、非法外部 require/dynamic import 都有明确回归。

真实 package checker 测量：Windows fresh process median 265.03 ms，
worker cold 241.88 ms、hot median 5.72 ms、12 次只初始化 1 worker。
这只是同输入单 checker 的对比，不是完整 CLI 的性能证明。
启动中关闭测试已拆为独立顶层用例，八个新真实包快照逐个在启动时关闭，
断言线程/队列/所拥有进程归零且未突破原清理额度；Linux suite 实际执行通过。
这些是避免旧冷加载/异步退出路径后的行为证据，不声称定位了 Node native assertion 的内部缺陷。

## 完整 npm CLI 的实际收益

Windows 全仓验证结束后，无并行测试时运行更新后的 `node scripts/measure-check-host.mjs`，
以完整 npm package 准备、CLI、discovery、认证 HTTP、structure/deliveries 两个真实 check
作为同一比较范围，没有跳过 package 准备。固定 Subject 为 279 字节，
包 revision 为 `sha256-pguide-package-v1:136dd8b7f53f5ff5b142f3100fbe19823ee927927dcf7e028d8f479e76d800fb`。

| 观测 | 结果 |
| --- | --- |
| shared cold 完整 CLI | 10270.13 ms |
| 每次新服务，3 次 | median 10021.09 ms |
| shared hot，6 次 | median 7180.24 ms |
| shared cold 服务 RSS / private bytes | 273.54 / 288.87 MiB，包含实际 Windows 权限 helper |
| worker 初始化 | shared 7 次 CLI 始终 2 个 worker，没有按请求重建 |
| RSS guard | 2×本轮 cold RSS = 547.08 MiB，通过；不是长期泄漏 SLA |

上述是新 npm 消费链同轮 fresh-service 与 hot 的比较；不跨版本/不同来源流程比较旧 Git
样本，也不承诺所有 registry/网络/平台条件的冷启动延迟。测量脚本保留单 checker 基线，
但不拿它与包含包准备开销的完整 CLI 宣称加速。脚本只停止归属已核实的 Host/helper，
在结束时删除自身 fixture，未发布任何包。
