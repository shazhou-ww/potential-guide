# Check Host 固定版本消费（2026-10-23）

## 状态与准确来源

用户已明确接受 `implementationRevision=0ae8c1991182dc555c7044b4147a0ae276fe53f3`；
`acceptInner` 随 `dc0224437ac7a49b7c63e2175533f9659ac244f2` 同步 primary。
随后在既有 Deployment 契约下开始外部消费，不改已验收 Inner World 或产品代码。
本轮不是 npm 发布、远程服务部署或生产变更。

本轮只闭合 D-S01/D-AC01；D-S02/D-AC02 仍受冷启动及启动中退出边界阻断，
没有 `submitOuter` 或部署验收。后续通过的热态测试不能覆盖先前冷态失败。

- 固定来源：`dc0224437ac7a49b7c63e2175533f9659ac244f2` 的 Git archive。
- archive SHA-256：`217f53d35bdef6d2da5999a992cbc4b7c70bea049e806eb63b18e1d93cd400a3`。
- 环境：Windows、Node v24.12.0、pnpm 11.22.0。
- 专属短路径根：`D:\Code\check-host-consumer-20261023-2156`；
  source、packs、consumer、logs 分离，不使用当前 worktree 的运行模块。
- [Consumption-inventory.json](./Consumption-inventory.json) 记录 18 个 public 包、
  4 个 private Objective 包的准确版本与 tarball SHA-256，以及全部 16 个入口的完整
  artifact revision。绝对路径是该次观测位置，不是后续必须复用的 discovery 运行态。
- 已安装 Host 的 private-files.js SHA-256：
  `b46e0c22ca761d9545ca068652651e92cc6c9704edd643521cdf40624c0fcd8d`。

固定 archive 独立构建后打包 22 个包，全部以准确 file tarball 安装到 consumer。
沿实际父依赖逐个解析并验证真实路径全部位于 consumer 内，未使用 workspace link 或
实时源码回退。构建/测试工具来自固定 source，产品运行模块来自独立安装包；
private worker 则从同一 tarball 解包的自包含产物执行。

首次直接读取 pnpm store 安装的 worker 时，Host 正确拒绝多硬链接文件。
随后独立解包这四个准确 tarball，逐字节比较 16 个入口的 worker.cjs 与安装副本，
并重新验证完整 revision；没有放宽单硬链、链接、内容或目录边界检查。

## 已完成的真实消费

复用固定提交中的既有测试，仅调整 consumer 的模块/产物路径和测试 fixture 的资源 URI；
断言与预算不放宽。root/package 消费使用同一原始 defaultPolicy 数据。
依赖源码专用的直接 `checkRepository` 测试不作为安装包验证，未用替代函数伪造通过。

| 观测 | 结果与边界 |
| --- | --- |
| 安装依赖图 | 22 个准确版本、全部真实父依赖均位于独立 consumer |
| 已安装 Host suite | 28 项：27 pass、1 实际 POSIX skip、0 fail；实际 Windows owner/ACL、权限失败、并发发布、崩溃恢复、排空更新、取消/清理和退役/预热均执行 |
| 双真实 CLI | 通过；只启动一个已认证 Host，后续 CLI 复用 worker；运行的是已安装 CLI 和 Host |
| root/package 真实依赖 | 冷态失败后明确重跑，3 项通过：独立包与根 Objective 的版本/调用顺序、结构策略先于依赖、真实包级缺陷成为 dependency problem 后修复并重新观察 |
| private tarball 执行 | 全部 16 个入口的资源、运行协议、无依赖加载回退及选定正例通过；不把 Windows 上的 Linux health 目标宣称为达标 |
| 实际 HTTP 断流 | 经代理转发真实 Host 当前帧后结束流；wait 明确报 `Check state unknown after disconnect`，原任务仍 Running，executions 仍为 1 |
| 明确取消与过期 | cancel 的 Cancelling 不冒充终态；继续观察到 Cancelled 后确认结果，保留期后 404，executions 不增加 |
| 集合与鉴权 | 活动集合不含 Subject，未认证读取返回 401；未知/过期 ID 不重跑 |
| 旧协议 | 仅含 run.mjs 的产物明确拒绝，不执行文件 |

已安装包内真实 package-standard/structure 测量为 12 次 fresh process，
median 257.76 ms；同输入的 worker cold 3131.56 ms、hot median 6.83 ms，
12 次只初始化一个 worker。这是单 checker 的比较，不是完整 probe CLI 的冷/热比较。
完整 CLI 的部署环境性能证据尚未闭合，不复制实施阶段的 3.70 s 作为本次消费结果。

512 次混合任务为 Completed 448 / Failed 32 / Cancelled 32，
peakWorkers=2、peakRecords=16，末批 queue/records/ownedProcesses=0，
close 后仍验证 workers/records=0。该轮 RSS 203.22→192.54 MiB；
96 次负载保留 145.46→181.18 MiB 的上涨样本，不宣称无限期无泄漏。

## 尚未闭合的部署阻断

### 默认初始化时限中的冷态失败

安装包环境中，真实 package checker 经原始 HTTP/上层观察、以及最小公开内核调用，
多次未在默认 5 秒内初始化，返回 Failed，而非业务检查未通过。
一次最小内核观测为 5018.34 ms、executions=0，
`error="Worker initialization timed out."`。
失败发生在执行之前，不能通过伪造 dependency evidence 或跳过检查消除。

同一固定产物后续观测存在明显差异：

- 直接在 native worker 中加载 CJS 约 220 ms，原始 runner 直接加载 capsule 约 234 ms。
- 原始 runner 加载由产品函数创建的快照，约 3539 ms 才 ready。
- 后续最小公开内核调用约 3940 ms 进入执行，并正确拒绝空 Subject。
- 冷态失败后明确重跑的 3 个真实 root/package 用例通过；第一项约 15.68 s。

以上是诊断样本，不是可相加的阶段耗时，也不证明具体根因。
原始冷态日志仍有效；没有增加 cleanupMs/startup allowance 或观察预算，
没有透明重试，不能只以热态通过关闭问题。

可在独立 consumer 下用下列最小入口重新验证原默认时限；workerDirectory 须来自
已核对完整 revision 的单硬链接 tarball capsule，不使用 pnpm store 的硬链接目录：

```js
import { resolve } from "node:path";
import { CheckKernel, readArtifact, terminal } from "@potential-guide/check-host";

const directory = resolve(process.argv[2]);
const artifact = await readArtifact(directory);
const kernel = await CheckKernel.create(resolve(".cache", "startup-reproduction"));
try {
  await kernel.executeCheck({
    checkId: "startup-reproduction",
    directory,
    revision: artifact.revision,
    subject: {},
  });
  while (!terminal(kernel.sample("startup-reproduction")))
    await new Promise((done) => setTimeout(done, 10));
  console.log(kernel.sample("startup-reproduction"), kernel.diagnostics());
} finally {
  await kernel.close();
}
```

### 启动中退出的额外风险

首轮独立传输 fixture 错将 Queued 当作已执行，在断言失败后的启动中 shutdown 路径，
Node v24.12.0 出现 `UV_HANDLE_CLOSING` native assertion（win/async.c:76）。
这不是一次通过；根因尚未确定，也不能只归因为 fixture 或认定产品已修复。
随后 fixture 按公开状态等待 Running，并按协议等待 Cancelling 到 Cancelled，
实际 HTTP 断流/取消/过期验证通过，但不能替代该启动中退出路径的定位。

## 接手与证据保全

D-S01/D-AC01 已记录 Agent 完成；D-S02/D-AC02 保持未完成。
下一步应先定位固定安装包的冷初始化与启动中 shutdown，必要时明确返回实施阶段修复并
重新验证准确候选，而不是在部署阶段改产品代码或直接提交部署门禁。
本轮未改 Inner World 或实现交付物，也未替用户追加任何接受决定。

原始日志、固定消费 harness、最小复现与原始 inventory 保存在当前会话验证资料中。
后续机器重建新专属 consumer，按本节准确 commit 与 inventory 重新打包校验，
不复制 descriptor、token、Host PID 或运行状态。临时 source/consumer 在保全证据并确认
本轮服务退出后清理；这些临时路径不构成发布或长期部署。
