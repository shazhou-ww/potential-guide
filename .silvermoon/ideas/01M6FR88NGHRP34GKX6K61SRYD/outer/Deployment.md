# Deployment

## Candidate

固定实现提交 `38c872cfd53a9e0343f05c12f73043f1caf6920b`，部署起点为已验收的
primary `e21d34f426a217438c680291d5af50759ab7e2d9`。
使用该源码构建的本地 tarball 与完整 Web UI dist，在独立目录安装和运行；
SDK、Protocol、Engine、HTTP、Storage、Server 与示例 bundle 均取同一候选，
具体包版本及 bundle digest 在部署证据中记录。
本次授权范围为隔离的本机独立消费者演练，不发布 npm、不替换共享服务或生产数据库。
部署证据将在同一 Outer World 的辅助文件中记录，不修改已验收的 Inner World。

## Steps

### D-S01: 固定独立消费候选

固定上述候选，执行既有本地 pack/install 消费验证，再从保留的独立 runtime 安装启动
SQLite Task Server；复制完整 built Web UI 至无 node_modules 的独立目录。
使用随机的进程内测试凭据、loopback 随机端口、新数据库及 scope 隔离策略，不输出凭据。

### D-S02: 演练实际日志查看

提交固定 digest 的 v2 示例 bundle，在真实浏览器查看 Run Logs，验证执行中与结束后输出、
暂停及重新连接、并发 Run 隔离和精简 Result；独立查询与订阅记录作为可复核证据。

### D-S03: 核验运行策略

在同一独立环境设置有限 entry/run/global/metadata/retention/subscription 参数，验证超限回执、
丢弃计数、过期及未授权访问的显式状态。保存不含凭据的实际结果和界面观察后关闭测试进程，
清理本次拥有的临时安装、数据库与配置；记录 SQLite 物理高水位和同步 I/O 等已知限制。

## Acceptance criteria

### D-AC01: 独立消费者可使用

以包版本、tarball/Bundle digest、独立安装/运行记录证明：作者通过独立 SDK 生成 bundle，
生产 host 不安装 SDK/Check/Probe，Web UI 无 node_modules，均无需源码工作区即可消费日志。

### D-AC02: 工作台体验符合预期

用实际 Run 的 history/SSE 查询和真实浏览器操作证明：实时、历史、并发及重新连接场景可用，
详细日志出现在独立 Logs 区域，Result 不混入 verbose 信息。

### D-AC03: 策略与限制可观察

用实际有限容量、权限和保留策略演练证明：未认证为 401、跨 scope 为 403，
超限及过期状态和缺口明确可见；存储记录数/字节及订阅容量不超过固定限额，
UI 保持既定有界窗口。此证明不承诺 SQLite 文件即时缩小、永久历史或硬实时磁盘延迟。
