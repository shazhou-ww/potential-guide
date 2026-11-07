# Deployment

## Candidate

固定实现候选 `26ab9bcfdf0caa382c79348f4bbb0e001d3caee3`，
其 `implementationRevision=e25596e463ce1306b1772d7caa23c7c8fe8e1ac3`
已由用户接受，验收事件所在 primary 为
`5385e013865ce5467e73565c7747b8e74ea83625`。
使用该源码构建的本地 tarball 与完整 Web UI dist，在独立目录安装和运行；
SDK、Protocol、Engine、HTTP、Storage、Server 与示例 bundle 均取同一候选，
具体包版本及 bundle digest 在部署证据中记录。
协议以当前 axis 的唯一 v1、独立日志 sequence 及 `frozen: false` 为准，
不因 RC 版本号或发布状态推断契约冻结，不复用旧 v2 候选的部署证明。
本次授权范围为隔离的本机独立消费者演练，不发布 npm、不替换共享服务或生产数据库。
部署证据将在同一 Outer World 的辅助文件中记录，不修改已验收的 Inner World。

## Steps

### D-S01: 固定独立消费候选

固定上述候选，打包并在独立 author/runtime 目录安装本地 tarball，
作者进程先生成自包含 v1 Bundle 并退出；runtime 仅安装 Server 的生产依赖闭包，
经隔离的 loopback HTTP IPFS Gateway fixture 获取验证过的 Bundle；
复制完整 built Web UI 至无 node_modules 的独立目录并限制其文件读取范围。
使用随机的进程内测试凭据、loopback 随机端口、新数据库及 scope 隔离策略，不输出凭据。

### D-S02: 演练实际日志查看

提交固定根 CID 的 v1 诊断 Bundle，在真实浏览器查看 Run Logs，验证执行中与结束后输出、
暂停及重新连接、并发 Run 隔离和精简 Result；独立查询与订阅记录作为可复核证据。
UI 必须实际消费该独立 runtime，不以源码 DOM 单元测试或旧浏览器记录替代。

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
