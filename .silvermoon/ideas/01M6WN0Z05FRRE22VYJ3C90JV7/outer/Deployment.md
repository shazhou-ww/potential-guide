# Deployment

## Steps

### D-S01: 验证 Windows 独立服务使用

按交付文档启动持久化 Task Engine，提供可读取预构建 Probe DAG 的内容来源，再以独立调用方提交 Monorepo 和设备整备 Probe。

Windows 上仅使用已经存在的两份作者 CAR 和 dist 入口；执行前后核对 CAR 的 CID 与 SHA-256，不运行构建、安装、发布或 pin。以独立 Node 进程运行 `scripts\serve-task-cars.mjs`，再以另一个独立进程运行 `apps\pguide-task-engine\dist\main.js --no-global-config --no-ui --port 0 --database <独占路径> --scope <操作 scope> --ipfs-gateway-url <内容源 URL>`。第三个进程调用 `scripts\submit-probe-objective.mjs`，只提供 CID 与业务输入。

全部服务使用 OS 分配的 loopback 端口和本次操作独占的 `.cache\outer-composition-<唯一值>` 数据目录，记录实际 URL、PID、命令和 SQLite 数据域。默认本机策略没有 token，不向证据写入凭据。

现存 CAR 的实际根与 Inner 的历史双端口运行记录不同；首次预检因此停止，尚未启动服务。本阶段不重建旧制品、不改写 Inner，而固定当前可读 CAR 的实际身份：已验证其中含通用 `task-invoke`、不含旧固定端口/演示身份，嵌入 Check pins 与作者 YAML 一致。后续两个端口都使用下面同一份现存字节：

| 作者包 | 当前预构建 Probe CID | CAR SHA-256 |
| --- | --- | --- |
| monorepo-standard | `bafybeiakytjzp72xbnzsqsxjyp3rldsfetqe3frj2qg3y37rg565rt6asy` | `47262421bfa80b2c0edb7d0b587a05c3bdcfab2b95c7be440bd415ca8d6fb244` |
| task-engine-device | `bafybeibl6wqhhbh2pn7nimgyemqz36ixjsyjmeo66sefacyrg6qbc2dbr4` | `0a39d49660926d9d2709795e0bd854f0bdb252acd7cb689c1e5d531011a3f98d` |

### D-S02: 验证配置变更与故障处理

换服务端口复用相同 Probe CAR/CID；在受控运行中验证取消、服务重启和资源释放，不改变共享服务或公共内容。

分别在两个不同 Engine 端口和独立 SQLite 数据库上运行两份相同 CAR，排除缓存结果代替第二次执行。正常运行完成后重启其中一份数据库，检查结果、关联和物理释放证明仍存在，且没有重复业务 Run。

另用独占故障数据库和操作自有的延迟 HTTP endpoint，使设备 Probe 的网络 Check 确实运行中：先通过 HTTP 撤回并等待父/子 `reclaimedAt`，再提交不同输入、确认持久父子关联后按准确 PID 强制停止 Engine。用同一 SQLite 重启，检查原请求/任务 ID 不变、未完成父/子需求已停止或取消、丢失的物理释放证明保持 unknown。不将 Windows 强制进程终止报告为优雅信号退出，不用撤回 ACK 代替释放证明。

本机服务策略要求所有 POST 带 `Content-Type: application/json`，包括无 body 的 cancel。原始默认 TaskClient 的无 body 撤回在实测中被明确拒绝，未发生撤回；操作调用方通过现有 `headers` 配置声明 JSON 写入再验证。不修改 Client/Engine 代码，不把该策略拒绝报告为释放成功；故障输入严格使用父 Probe 已声明的业务字段。

## Acceptance criteria

### D-AC01: 正常运行流程可复现

保留 Windows 命令、服务配置及父/子 Task 结果作为证据；执行阶段不构建包、不隐式启动第二个 Engine，结果包含真实 Level 与文档引用。

证据包含独立调用方结果、真实父/子 Task/Run ID、Check CID、parent 关联、terminal Level 与有效 IPFS 文档引用，以及各自的 Worker exit/reclaimedAt。验证 SQLite source facts、事件/checkpoint checksum 和数据域，保留精简的数据库证据而非凭据或整份二进制库。

### D-AC02: 同一产物可迁移且可清理

以相同 CID 的换端口运行和受控故障记录证明部署配置不影响 Bundle 身份，取消与重启后不会把未确认子任务报告为已释放。

记录受控撤回前后的状态、异常停止及恢复事实、原 request ID 的幂等状态，证明无重复子 admission。退出前确认全部自有服务/调用方 PID 已停止，自有 HTTP 连接关闭；提取持久证据后仅删除已核实归属本操作的 scratch/data 路径。Inner/Ideal 内容保持已验收版本不变。
