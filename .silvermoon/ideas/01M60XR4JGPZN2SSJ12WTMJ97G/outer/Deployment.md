# Deployment

## Steps

### D-S01: 准备独立 v2 消费环境

先同步准确交付契约，在源码仓库外安装已构建工具，使用受控制品来源与真实 Host 验证 SDK/HTTP；不以源码 import 或测试替身冒充交付。

通过 [verify-deployment.mjs](./verify-deployment.mjs) 在仓库同级创建带随机 owner marker 的
操作目录，pack 已接受源码的运行依赖闭包，以 `pnpm install --offline --ignore-scripts`
安装 tarball 与既有 store 中的依赖。作者用安装后的公开 build/pack API 显式生成 Check
与固定 Objective 数据；独立消费者只 import 安装的包名，禁止 checkout/dist、源码链接、
NODE_PATH、loader 或 test hook。每个模块 realpath 必须位于外部目录。

本次平台范围为 Windows/Node 24。受控 HTTPS 发布者使用本操作 CA，客户端正常验证 TLS；
无 CA 的独立请求必须失败。私钥、token、签名参数不进入持久证据。

### D-S02: 验证竞争场景与业务接入

实际验证版本切换、两种 freshness、多 Task 订阅、共享执行取消及超时，并通过 Pilot/regulator 消费固定 Check 版本；记录准确证据和资源清理。

已安装 [author.mjs](./author.mjs) 和 [consumer.mjs](./consumer.mjs) 以文件 gate、初始化、
进入/清理记录和 Task 快照仲裁真实时序，不用固定 sleep 猜测运行状态。
同一个 Host 组装已交付 ArtifactManager/TaskScheduler/Kernel：两个 worker，执行墙钟
3 秒、初始化/清理宽限 3 秒，独立 Task 默认总期限 20 秒。初始排队、运行中分流、
独立取消/期限、墙钟封口及物理回收分别断言；后来观察不得延长旧执行。
服务须经真实鉴权 HTTP ready 检查后使用。验证结束关闭 HTTP/SSE、kernel、permission
helper 和作者 HTTPS 服务，等待子进程退出，再仅删除 owner marker 匹配的操作目录。

## Acceptance criteria

### D-AC01: 普通用户只管理观察需求

独立消费者通过 URL/可选 digest 和 CheckTask 完成运行、查询、过滤订阅及结果获取，无客户端制品物化；浮动更新与固定版本实际结果可区分。

证明两个排队强 Task 共享一个 Execution；V2 仍运行时同 URL 改成 V3，两份内容同时存在，
固定 digest 仍选择 V2。单/多 Task 使用统一 SSE，初始终态及重连快照不重新执行。
非法 SDK JSON 须零 HTTP，合法数据可创建。记录安装退出码、模块定位、工具 tarball
SHA-256、制品 logical/transport digest 与实际 execution revision。

### D-AC02: 生命周期与迁移边界真实成立

记录共享 Task 与 Execution 对应关系、期限和取消结果及物理清理，证明业务重查使用正确时间下界；v1 处置和历史证据符合已同步契约，不提前宣称正式发布。

真实 weak 加入已进入代码的运行，strong 创建不同物理执行；一个 Task 取消/超时不伤其他需求。
最后需求撤销观察协作清理；失控 worker 到墙钟后先失败，再确认其子进程和 worker 回收，
健康 worker 正常完成。真实 Pilot/regulator 读取 HTTPS 固定 Check/原始 References、
保留 owning digest，并在来源更新且作者 Objective 移走后通过已固定证据准确恢复。
纯状态机 late-resolution 等不伪造为外部部署，引用已接受的
[inner 证据](./inner/verification.md)。v1 仍是显式短期兼容，不能控制 managed v2 Execution。

## Reproduction

先将本契约及脚本同步 primary，再从仓库根执行：
`node .silvermoon\ideas\01M60XR4JGPZN2SSJ12WTMJ97G\outer\verify-deployment.mjs`。
输出脱敏 JSON 到本操作 `.cache`；成功后持久化 outer 证据并勾选 ledger。
本阶段不发布 npm/GitHub Release，不推进 release idea，不修改已接受 inner/ideal 或实现源码。
