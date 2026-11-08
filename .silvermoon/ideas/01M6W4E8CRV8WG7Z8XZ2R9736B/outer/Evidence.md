# Probe Task Bundle 独立交付与门限评审

## 验证基线

本轮按已同步 `deploymentRevision=29a525be2ef5f8cbdb7ab0b2b1306e88496a236b`
执行验证，产品源码固定为 `5428223891ebd6a049048aa5d8eb7e3cd972e017`。
Outer supporting evidence 的新增正常改变外层修订，未修改已接受的 Inner 或 Ideal。
执行入口为 [deliver.mjs](verification/deliver.mjs) 与 [consume.mjs](verification/consume.mjs)。

包构建产物经本地 pnpm pack，11 个内部包及所需公开依赖安装到仓库外的独立消费者，
由 Node **v24.12.0** 执行。消费脚本只导入已安装包，不导入 source/test runner；
关键模块 realpath 全部位于该消费者的 node_modules。
`npm install --ignore-scripts --no-audit --no-fund` 和 `npm ls --all --json` 均退出 0。

- [包版本、tarball SHA-256 与安装位置](verification/results/packages.json)
- [独立 package-lock](verification/results/package-lock.json)
- [完整依赖图](verification/results/dependency-graph.json)
- [安装日志](verification/results/install.log)
- [最终运行摘要](verification/results/consume.log)

SDK 仍为 private workspace 包；这些本地 tarball 未发布 npm。

## 真实内容获取与交付

只读访问 `https://pinboard.shazhou.work`，取得真实 tools Check 根：

`bafybeifydrqggqypfapxiwt2bpovdprxae6iysrjhiua3d2jebico74u7a`

完整读取 **17 个内容块、11 个文件**，校验 raw MIME、所有块 SHA-256 与 CID、
规范 UnixFS 树及 Check 契约。不是只探测根块或使用旧 pin 元数据。
然后用已安装 prepareProbe → buildTask → verifyProbeResources 构建父制品，
通过自有 loopback raw-block Gateway 提供真实 HTTP 内容。

最终 Probe 根：

`bafybeigpblob5n2nqr4w2x2biv2h5c3hiyrbzvyqxrbul5b3gmdixzjnuu`

最终 CAR 容器 SHA-256：

`a227e3e5b608673584f0788539deb4f00c494ef0f8f1622e3e93c41a7fa2124b`

CAR 容器散列只用于本次交付凭据，不是第二种内容身份。
从 HTTP 重新遍历父根后物化 **23 个文件**，文件集合与字节逐一核对；
实际 `resources/checks/tools` 子目录根等于原 Check 根，不仅是文件内容相同。
原始、完整的请求和返回证据见 [deployment.json](verification/results/deployment.json)。

## 独立执行与文档

标准 `startTaskServer` 使用独立 SQLite、显式本地调用权限与只读 Gateway，
Probe Worker 经公共 TaskClient 提交独立子 Check。未增加 Engine 业务分支，
没有动态 require 子 Worker，也未依赖本地 Kubo。

| 场景 | 实际结果 |
| --- | --- |
| 首阶段工具版本不满足 | Task completed，currentLevel 为 prepare-environment，返回 environment 失败项。 |
| 首阶段通过、后续工具版本不满足 | Task completed，currentLevel 为 prepare-project，返回 project 失败项。 |
| 全部通过 | Task completed，currentLevel 为 terminal，checks 为空。 |
| 自有子 Check 抛出异常 | 父 Task failed，没有伪造业务结果。 |
| 运行中的自有慢 Check 被父取消 | 父 Task stopped，独立子 Task 也记录取消。 |

共 **5 项场景全部通过**，记录 **15 个 Task / 15 个 Run、66 条 HTTP 响应**；
所有 Run 均有 exit 和 reclaimedAt，没有 cleanupUnknown。
实际读取 **10 次结果节点文档**及额外的原始 Check Problem 文档：
首阶段覆盖页指向 Probe 根，后续继承页指向原 Check 根，
Objective/当前阶段/Check/Problem 都可独立按完整 URI 读取。

## 固化与发布边界

作者来源使用本次自有 HTTP publication-shaped fixture，通过显式 transport
提供与已核实 Pinboard 公共 metadata 相同的结构；`owned.invalid` 仅为配置 locator，
没有访问或声称部署那个公共域名。
首次解析固定到真实 tools 根，仅调用一次来源解析。
随后将该自有指针从 revision 1 更新为 revision 2，指向另一份实际构建并完整验证的
Check Task Bundle：

`bafybeihsuohyc7zx65565lsyvyiwbwhv2o5kb3onkvuhalvsy3ulhdncd4`

锁定模式重准备与原 Probe 再次执行仍使用初始 tools 根，解析计数仍为 1。
该证据证明更新后的来源不会改变既有成品，不声称更新了真实 Pinboard publication。
真实 Pinboard 旧 publication 的正确拒绝见 Inner 证据；本轮未创建、上传、pin、
回滚或更新任何公共制品/指针。

## 检查、失败记录与清理

最终 delivery 命令退出 0，`passed=true`、`closed=true`。
脚本语法检查通过；.silvermoon 的 supporting scripts 被现有 Biome 配置排除，
因此不将“没有处理文件”的 Biome 返回记作 lint 通过。实际交付运行验证脚本行为。

Windows 带空格路径复跑曾暴露部署 helper 将本地 tarball 表示为百分号编码 file URL：
npm 没有解码而产生 ENOENT。已改为 shell-free cross-spawn 和相邻目录的相对 file 依赖，
带空格路径完整复跑成功。保留 [首次安装失败](verification/results/initial-install-failure.log)，
不把该失败冒充产品测试失败或成功。最终证据来自之后的新独立目录完整运行。

所有自有 HTTP 服务已关闭，实际请求确认原端口不再响应。
Inner 留存的验证镜像在确认卸载后清理；未修改共享 pnpm store 或全局机器设置。
局部依赖 store 保留供工作树后续开发使用；复现交付需要重新 pack/install，
不能假设本轮临时消费者、端口、tarball 路径和验证镜像永久存在。
示例 Worker 绑定临时本地 transport，重建时根 CID 可随端点改变；
这不是同一固定作者输入产生了不同 CID。

最终 deployment.json SHA-256：

`865c721b9f3966f1395e37a9bbc031f07effb2159fbd6a79ae082af51e58871e`

## 门限审查

按用户明确委托自主审查：D-S01、D-S02、D-AC01、D-AC02 均有上述独立证据，
可以对准确同步后的 Outer revision 记录接受。门限不是 waived，
也未将源码测试或构建结果代替真实交付结果。
结论仅覆盖约定的临时自有交付渠道及独立消费，不宣称 npm 发布、
公共 publication 更新或长期服务可用性。
