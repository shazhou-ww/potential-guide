# Deployment

## Steps

### D-S01: 确认真实 Gateway 与制品交付条件

验证 Pinboard 候选入口的 raw-block HTTP/MIME、CID 校验与完整 DAG 获取，记录精确 Bundle CID。
选择真实备用来源和可用的精确产品版本；缺少外部授权或服务能力时显式记录阻塞，不假设兼容。

### D-S02: 走查无本地 Kubo 的消费路径

在独立 Linux/macOS 消费环境安装已交付包，配置多 Gateway，
经公共 HTTP 验证基础 Check、物理回收、相同 Request 幂等和同 DB 重启恢复。
现实发布或制品写入仅在另有明确授权时执行，不因本构想自动发布。

### D-S03: 验证现实故障与保留证据

在自有测试配置中模拟首选不可达及全部来源失败，记录结果、时间预算和诊断；
保留版本、CID、端点类别、Task/Run 身份与恢复证据，停止自有服务，不干扰共享网关。

## Acceptance criteria

### D-AC01: 真实来源可交付同一内容

Pinboard 与备用 Gateway 的实测记录证明可读取所选 Bundle 的完整有效内容；
不把普通文件下载链接、单根块探测或已有 pin 记录当作完整证明。

### D-AC02: Node-only 软件前提完成业务与恢复

消费执行不依赖本地 ipfs 命令或 Kubo 进程；Check 结果、Run 退出/回收和重启后
Request/Task/Run 身份及历史有真实 HTTP 证据，精确版本与 lockfile 可复现。

### D-AC03: 故障路径有界且不虚报

真实走查证明首选故障可切换备用、全失败明确报错，等待和取消符合约定预算，
诊断可定位来源；保留证据而不把基础 happy path 成功扩大成所有场景已通过。
