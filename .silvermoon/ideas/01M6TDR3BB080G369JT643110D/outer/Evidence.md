# 独立部署验收证据

## 审批与验证边界

用户已明确委托父代理自主进行文档、实现和部署审批，并要求推进至 completed。本轮父代理审阅已提交的实现契约及全量检查证据，接受 `implementationRevision=d4afe07fe4dd7fd4791ddcfb403958bc190d52b6` 后，先将具体部署契约同步至 primary `2a8798d85ed0e9cba2a06fdd1e6f5c3460c3132d`，再独立执行本节验证。

验证使用接受实现的真实打包产物，不从源工作区加载运行时模块，不复跑源码测试冒充部署。未发布 npm 包，未改变共享服务、用户全局命令或用户 Kubo 配置；这里的部署验收是隔离消费验证，不声称已向公共网络提供服务或保证内容持久可用。

## 可复核材料

- [部署原始记录](verification/deployment-proof.json)：真实导入回执、十次请求和结果、物理释放、逐语言读取的 URI 与完整正文、版本重读、不可用错误和清理结果。
- [打包清单](verification/packs.json)：七个实际 tarball 的版本、路径和 SHA-256；路径是当时的隔离环境位置，临时安装在取证后清理。
- [准备脚本](verification/prepare.mjs)、[双语言构建脚本](verification/build-text.mjs)、[独立消费脚本](verification/consume.mjs)：父代理实际执行的公共接口验证流程。脚本与本节同目录的 verification 文件集一起使用，不需要作者工作区依赖进入 runtime。

原始部署记录 SHA-256：

```text
c7c1e25bb06f62977950df4b41607bbd2ed7ffa727fcceac1117d5b7c4020c8a
```

## 执行环境与命令

Windows，Node `v24.12.0`，pnpm `11.22.0`，Kubo `0.43.1`。部署记录的实际运行时间为 `2026-11-07T08:23:47Z` 至 `2026-11-07T08:23:49Z`，完整毫秒时间以原始记录为准。

父代理新建专属 Kubo repository，以 test profile 初始化，API 和网关绑定随机 loopback 端口，以 offline 模式运行。本次 API 为 `http://127.0.0.1:55713`，网关为 `http://127.0.0.1:55714`；启动后实际请求 version 并读取文档确认可用，没有启动外部联网服务。

在仓库外新建独立消费者，按顺序执行：

```powershell
node <verification目录>\prepare.mjs <源仓库> <全新的隔离消费者目录>
Set-Location <隔离消费者目录>\runtime
$env:NODE_PATH = ''
$env:NO_PROXY = '127.0.0.1,localhost,::1'
node consume.mjs http://127.0.0.1:55713
```

准备脚本按生产依赖安装本修订打包出的 tarball，并以既有消费者工具验证完整安装图。author 与 runtime 分开安装；runtime 唯一直接依赖是 task-engine，其内部生产包只有 task-engine 和 task-protocol。消费脚本断言无法解析 check-sdk 和作者编译器，且 Engine 实际加载位置位于隔离 runtime 内。

首次构建在读取已安装包的 CAR 时触发已有 canonical-file 守卫：pnpm 的链接路径或硬链接不可直接当作普通制品文件。父代理仅修正验证脚本，先将 CAR 复制为隔离 artifacts 中的普通文件，再调用原有 readTaskArtifact。未放宽守卫或修改已接受实现；恢复后作者构建成功，独立消费退出 0。

PowerShell 首次请求本地 API 受到宿主代理影响返回 403；用显式不经过代理的 curl 及 Node 原生 fetch 确认私有 API 为 200。消费执行走真实本地 RPC，未使用错误响应或内存映射作为成功替身。

## 真实内容与结果

三份环境 CAR 来自已安装的 check-environment 包，经复制、制品验证后导入私有 Kubo。双语言 text 使用同一源码、相同 YAML，通过 prepareCheck、buildTask、verifyCheckResources 生成 A/B；只改变文档，断言 Worker 字节相同、最终 CID 不同。

| Bundle | 实际根 CID |
| --- | --- |
| tools | `bafybeifydrqggqypfapxiwt2bpovdprxae6iysrjhiua3d2jebico74u7a` |
| directories | `bafybeicx45guntfoueeddml532gfayxuvo5jhujuf4q2wasnef4ysyrfhe` |
| network | `bafybeibgc2yxmiynaq3m64ptpch6bi4ion7pqx5zh7tda6bfkxqx7ie7si` |
| text A | `bafybeifu63sjbf2q2zzihh6s4a7tsuzitxrt6etcjepky7hn6t6cqkkr4u` |
| text B | `bafybeicnqosy4yfdndt2wtdcdxb7cqz2wibyfuiydqiled7i6ysmn6hvoe` |

通过公开 Engine 执行与真实 Kubo block/get 读取完成十个案例，全部达到 completed 并确认物理释放：

| 案例 | 业务结论 | 问题 | 支持语言 | 首次文档读取 |
| --- | --- | --- | --- | --- |
| tools/pass | pass | 无 | en | 1 |
| tools/fail | 未通过 | tool-version | en | 2 |
| directories/pass | pass | 无 | en | 1 |
| directories/fail | 未通过 | directory-unusable | en | 2 |
| network/pass | pass | 无 | en | 1 |
| network/fail | 未通过 | http-status | en | 2 |
| textA/pass | pass | 无 | en、zh-CN | 2 |
| textA/fail | 未通过 | text-empty、text-short | en、zh-CN | 6 |
| textB/pass | pass | 无 | en、zh-CN | 2 |
| textB/fail | 未通过 | text-empty、text-short | en、zh-CN | 6 |

总计 25 次首次文档读取。调用方分别 structuredClone 每个 result 和 problem，检查全部语言键，将节点自带的完整 URI 直接交给真实 Kubo cat；读取函数不接收父节点、问题 code 或资源索引。通过结果包含检查文档但不含 problems。每个未通过问题保留 target、code、actual，并有自己的全部语言引用。

## 版本、不可用与清理证明

- B 导入并完成执行后，又对 A 的分离节点进行 8 次逐语言读取；仍得到 A 标记正文，而 B 节点得到 B 标记。URI 的根全部与各自执行 Bundle 一致。
- 对全部 17 个 result/problem 节点选择未声明的 fr 均明确拒绝；没有静默语言替代。
- 对同样的 17 个节点使用本次自有的 HTTP 503 文档传输端点，均记录 `Kubo cat: HTTP 503: Controlled documentation transport outage`。读取前后结果序列化完全一致，没有把文档故障写成检查问题或修改 pass。
- 消费脚本关闭 Engine、MemoryStore 及两个自有 HTTP 服务，`cleanupErrors: []`。MemoryStore 仅是一次性事实存储，不是伪造检查执行器或 IPFS 内容客户端。
- 父代理在取回记录后对本次独占 IPFS_PATH 执行 ipfs shutdown；后台 daemon 退出 0。临时 Kubo repository、隔离安装及中间打包文件随后清理；持久证据保留在本世界中。

独立消费者最终输出 `success: true`、`cases: 10`、`cleanupErrors: []`。本证据满足当前部署契约 D-AC01、D-AC02；部署审批仅接受该准确证据版本，不意味着 npm 发布、公共网关可用或历史 Bundle 的隐式升级。
