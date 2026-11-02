# Request 受理与幂等处理

本契约约束 Request 到 Task 的受理过程，防止非法输入、重复创建及同一请求标识下的意图改写。

关联 [职责入口](../task-engine-responsibilities.md)：operation A1，提交 Request。

1. 检查 `requestId` 的 ULID 格式及可受理时间窗口；过期或过于超前的 ID 明确拒绝，包括幂等重试。
2. 在窗口内按完整 `requestId` 做幂等检查：相同原始意图且原记录仍保留时返回原 Task，请求内容冲突则拒绝；原记录已清理时按下述保留规则明确报告不可用。
3. 新 Request 通过输入 Schema 及准入检查后创建 Task。
4. 在绑定数据域内，根据 `matchPolicy` 等匹配条件，决定是否需要调度新的 Run。Request 幂等与 Task–Run 匹配是不同的判断，不合并独立 Task。
5. 同一 `requestId` 并发提交也最多创建一个 Task；受理成功返回前，Task 的受理事实与幂等依据必须可靠保存。

## ULID 可受理窗口

1. 以服务端时间检查 ULID 的时间部分：拒绝早于可受理下界的 ID，也拒绝超过允许时钟偏差的未来 ID。
2. 可受理下界在数据域内只前进、不后退；时间回拨、重启或配置调整不能使已经过期的 ID 重新有效。
3. ULID 时间由外部参与者提供，只用于准入检查，不证明实际生成时间，也不替代服务端 `receivedAt`。
4. ID 过期只限制提交及重试，不取消已受理 Task，不改变其时间边界，也不限制它预约未来生效。
5. 更换 ID 属于新 Request，不享有原 ID 的幂等保证。
6. 公开配置默认 windowMs=86,400,000、futureSkewMs=60,000；windowMs 为正，futureSkewMs 可为 0。
   每次准入先可靠推进下界 L=max(已持久下界, now-windowMs)，再检查时间戳 t 满足 L <= t <= now+futureSkewMs，
   两端包含等号，包括幂等重试；新域下界初始化为 now-windowMs。扩大窗口也不得回退已持久下界。

## 幂等凭据保留

1. 在 ID 仍可能被受理期间，必须保留足以核对原始意图并定位原 Task 的幂等凭据。
2. ID 确定过期后，才可清理对应凭据；后续重试按过期拒绝，不能重新创建 Task。
3. 清理 Task 详情不能提前失去幂等保证；原记录不可提供时应明确报告不可用，不返回伪造 Task 或当作新请求。
4. 幂等凭据过期不要求立即删除 Task 历史，两者的保留目的不同。

跨重启与清理的约束见[持久化与重启后的行为](./persistence-recovery.md)。
