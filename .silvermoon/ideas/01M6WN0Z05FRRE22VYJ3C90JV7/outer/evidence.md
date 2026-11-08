# Windows 独立部署证据

## 执行边界

2026-11-08 UTC 09:00:19–09:00:34，在 Windows、Node v24.12.0 上完成最终验证。
外部检查前已将实际 CAR 身份、JSON 控制请求头和故障步骤同步到 primary
`b99913b7664be05f83f0b6fe9b6b2ad20e8f0473`，
检查使用的 Outer revision 为 `4fdde2f8320c261b42dde60a4108a835247de2cc`。
本阶段未构建、安装、发布、pin，未改动已验收的 Inner/Ideal 或生产代码。

使用独立 Node 进程提供只读预构建 CAR，另一个独立进程运行持久 SQLite Engine，
再由独立 CLI 进程提交 CID 和业务 JSON。没有内嵌 Engine 或隐式启动第二个服务。
完整命令、输入路径、PID、真实 Task/Run、关联、结果和数据库证明见
[运行记录](./runtime-evidence.json)；其中没有 token 或环境凭据。

## D-AC01：正常流程和真实结果

内容源为 `http://127.0.0.1:51259`（PID 52704）；操作 scope 为
`outer-composition-01M6WN0Z05FRRE22VYJ3C90JV7`。Engine 均使用
`--no-global-config --no-ui --port 0 --database <独占库> --scope <操作 scope>
--ipfs-gateway-url <内容源 URL>`，没有 UI 或共享 IPFS 节点。

| 运行 | Engine URL / PID | 父 Task | 父 Run |
| --- | --- | --- | --- |
| A monorepo-standard | `http://127.0.0.1:51272` / 56520 | `01M6X668WKQGHK8Y1STQ067SV7` | `01M6X668X9PCJ4TD785CXJGR1M` |
| A task-engine-device | 同上 | `01M6X66AT1CW2AZA088DZPNK83` | `01M6X66ATKCBPHQ8VVYEZCTHS8` |
| B monorepo-standard | `http://127.0.0.1:55798` / 30552 | `01M6X66E4N7Q45M04WG4XG3PZ8` | `01M6X66E5AMF2A24PH41ZWE7ZC` |
| B task-engine-device | 同上 | `01M6X66G2ZRVRSBHVDE53PS5XQ` | `01M6X66G3QAKC39MV9VS2W74ZJ` |

四次外部调用均退出 0，父 Task 为 completed、当前 Level 为 terminal、checks 为空，
保留真实 `ipfs://<Probe CID>/resources/references/en/...` 文档引用。
每次均有三个独立 Check Task/Run，其 CID 对应父 CAR 的嵌入路径，parent 关联深度为 1；
所有 4 个父 Run 和 12 个子 Run 均有实际 Worker exit 与 `reclaimedAt`。

两个 Engine 使用不同 SQLite 数据域，排除第二个端口仅查询旧结果。
同一份 CAR 在 A/B 运行前后 SHA-256 未变；两份实际 CID/字节 hash 已固定在
[Deployment](./Deployment.md)，没有把它们冒称为 Inner 历史记录中的旧 CAR 根。

## D-AC02：持久化、撤回和异常恢复

### 正常数据库重启

A 库数据域 `a2ce61eb-629d-46e3-aa49-89b181e724b1` 在 PID 56520 结束后，由
PID 45988、端口 55788 重新打开。同样的 8 个 Task/8 个 Run、6 份子关联及结果/
释放时间保持不变；73 个 source events 和 checkpoint SHA-256
`e2b9ec9830148c91f00c963a11e890da827403490e80568bfcd457a5034e8c07`
也未变，没有重新运行父业务或复制子 Task。

### 受控撤回

故障 Engine 为端口 59969、PID 34256。自有延迟 endpoint 确认网络 Check 已真实
发起 HTTP 请求后，使用符合本机策略的 JSON POST 撤回：

- request：`01M6X66HR1ET2JQ3AP2MHQ4P3D`
- 父 Task / Run：`01M6X66JFTEB0F98B3EJJNATKX` /
  `01M6X66JGH9W2C56YKV4CHNXTH`
- 网络子 Task / Run：`01M6X66KNT17QWXXCZP6ZHFCKQ` /
  `01M6X66KP6DFK5RFXW2B9F4BE8`

未将撤回 ACK 当释放证明。随后重新查询，父与三个子 Run 均已有 `reclaimedAt`。
父需求 `canceled=true`、stopRequested 为 no_active_demand；实际父状态为 failed，
错误为 `type_channel_failure: This operation was aborted`，外部调用方退出 1。
该真实 abort 结果没有被改写成业务通过或伪装为 stopped。

### 运行中强制停止与同库恢复

第二个网络 Check 已发起延迟 HTTP 请求后，按准确 PID 强制停止 Engine，未宣称
Windows SIGTERM 是优雅关闭。外部调用方退出 1，保留原 request ID 和传输失败。

- request：`01M6X66M141ABG7YDG9991B0R9`
- 父 Task / Run：`01M6X66M1Z4J00451J404S4590` /
  `01M6X66M27NEYR62EXNQ3YS0EM`
- 网络子 Task / Run：`01M6X66ME5HPHQB9G0SZMEWCDW` /
  `01M6X66MEDM9BHKTFS64K1YQFE`

同一故障库由 PID 9132、端口 59893 恢复。数据域仍为
`2ebd7d7b-1e56-48ae-adc4-71e9477b1efd`，8 个 Task/8 个 Run 数量不变。
原父 Run 和网络子 Run 为 recovery/stopped；子需求已取消，二者都没有
`reclaimedAt`，明确保留 `Recovery does not prove physical exit or cleanup.`。
以原 request ID 和原意图重放，仍返回原父 Task，没有复制 admission 或业务 Run。

SQLite user_version 和 projectionVersion 均为 5。所有检查点和 source event 的
checksum 均经读取验证；异常前后分别为 72/76 个事件，原始幂等/父子事实仍存在。
这里只保留精简逻辑数据库证据、主库/checkpoint hash 和事件计数，不提交二进制库。

## 操作调整与明确限制

- 首次 CAR 预检发现当前根与 Inner 历史不同，启动服务数为 0；验证通用调用、
  无旧演示地址/身份及原 Check pins 后，先同步当前身份再部署，没有重建旧 CAR。
- 一次探索性输入包含父 Probe 未声明的 checkTimeoutMs；按已声明业务字段修正。
- 默认 TaskClient 的无 body cancel 未带 JSON 媒体头，被本机策略明确拒绝。
  使用现有 `headers: {"Content-Type":"application/json"}` 配置完成受控撤回，
  没有改动 Client/Engine。未经该配置的控制调用不能假定撤回成功。
- Task 与 Run 分别读取不同 snapshot revision；一次过早断言见到旧 stopping
  Task 与稍后的已回收 Run。最终验证等待终态 Task 与物理证明同时满足，
  不把不同 HTTP 读取当作原子快照。失败尝试和安全清理摘要保留在运行记录中。
- crash 后未知副作用/物理释放没有被“已取消”掩盖；本证据不保证任意 Worker
  OS 副作用可撤销，也不扩展跨 Engine、多租户或公共发布。

## 清理与验证状态

最终验证的 12 个自有源/Engine/调用方进程及控制进程 57484 均已退出；
独立准确 PID 查询未返回这些进程。两个自有延迟连接和 HTTP helper 均关闭。
数据库证据提取后，仅删除已验证 owner 标记的本次操作数据目录；失败尝试的
服务也都已停止，其独占数据已安全删除。未触碰其他 worktree、共享服务或 pins。
执行期间未运行会构建产物的 pnpm check；既有 Inner 检查限制仍按原证据保留，
本阶段的外部验证结果与 Silvermoon snapshot 检查分开记录，不声称全仓检查通过。
