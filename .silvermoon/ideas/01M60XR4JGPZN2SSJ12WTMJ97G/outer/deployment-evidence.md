# 独立 Host v2 部署证据

## 契约与范围

验证基于已接受的 inner `d1d690f76c5516b961f6247c08473699a08cdc4a`，
仅修改本 outer 的契约、验证脚本与证据。实现源码、Ideal、其他 idea 不变。
真实验证前同步契约/脚本到 primary；每次执行 receipt 记录当时的 primary、
deploymentRevision、Deployment.md blob 与脚本 SHA-256。当前 D 条目仍未完成。

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
