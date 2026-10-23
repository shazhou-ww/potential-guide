# Implementation

## 当前进度（2026-10-23 交接）

当前仍为 `implementing`，未记录 `submitInner` 或实施验收；所有 I-* ledger 项保持未完成。
实现检查点 `add8c7ea9f4f` 已随合并提交 `ba7e9f82134b` 同步至 primary，
可从另一台机器接手。详细命令、结果与限制见
[实施证据的 Checkpoint 5](./Implementation-evidence.md#checkpoint-5可跨机器继续的未完成候选2026-10-23)；
以下为当前候选摘要，不以此前检查点的通过结果替代最新验证。

### 已实现与已有证据

- I-S01/I-S02：已接通无 HTTP 内核、worker 调度、开始/取消/观察四路由、
  CLI discovery 和业务依赖结果处理；6 个 Objective、16 个 check 已迁移，
  无旧协议回退，生成物检查通过。
- I-AC01/I-AC02：已有真实双 CLI、线程复用、revision 冲突及排空、
  观察容量回收、退役/预热、取消及清理隔离、六轮启动/崩溃验证。
  Windows discovery 私有 ACL 已有实际验证；POSIX 互斥已有候选实现，尚缺实机证据。
- 最新独立 Host suite 为 27 项：26 通过、1 POSIX 跳过。
  512 次混合任务为 Completed 448 / Failed 32 / Cancelled 32，
  关闭后 workers/records 为 0；这不是无限期无泄漏证明。
- 同环境完整 CLI 实测 cold 17.39 s、复用服务 hot median 5.03 s，
  每次新服务 median 17.08 s；完整服务冷后 RSS 248.08 MiB。
  该样本证明复用收益，不证明冷启动或绝对内存优于旧架构。

### 未闭合项与接手顺序

1. 定位最新 `pnpm check` 的失败：
   `packages/objective-pilot/test/dependency.test.ts:349` 的进程退出确认断言
   预期 ESRCH，但 `process.kill(child.pid, 0)` 未抛异常。根因未知，
   不预判为 PID 复用、测试噪声或真实清理失败。
2. 在实际 POSIX 平台验证 private owner/mode、CAS 互斥、
   discovery 和锁持有者崩溃恢复；Windows 通过与平台 mock 不能替代这些证据。
3. 修复后对最终候选运行完整 `pnpm check`（含 pack），
   完成当前版本的 18 包/16 入口隔离消费验证。此前 checkpoint 4 的
   `pnpm check` 和打包通过仅适用于当时版本；最新候选全量检查 exit 1，
   后续 root tests/pack:check 未进入。
4. 证据闭合后再更新 ledger、同步最终候选并提交实施门禁；
   当前不进入部署或发布。

换机器先刷新 primary 并确认上述检查点可达，再读本文件、实施证据和 accepted Design。
本机 `.cache` 日志不随 Git 同步，不复制 descriptor/token 或运行状态；
新验证创建专属私有 Host 根，先审查清理路径及 PID 归属并认证 readiness。
此前危险清理的历史影响仍未知，用户已明确授权继续实施，不将该授权视为环境完整性结论。

## Steps

### I-S01: 收敛协议与所有权

按 [最小设计](./ideal/Design.md) 定稿目录/revision、自包含产物、worker 消息和开始/取消/观察接口，
以 `executeCheck :: WorkerDirectory -> Revision -> Subject -> IO (Behavior CheckState)` 为不动点，
明确单项当前状态、终态及活动集合的采样/订阅；HTTP 只做投影，
不添加注册、会话或 Host 管理接口，观察连接不拥有执行寿命。
内置 check 通过 CheckResult 返回 Objective/subject/level 依赖要求，上层处理并校验实际事实，
不将依赖字段、回调或递归调度编码进 Host 协议。
明确容量、任务数退役与预热额度，不建设任务恢复平台或两套队列/状态源。

### I-S02: 接通共享 Host 与检查器

只新增 packages 下的可复用 Host 包，在包内分离无 HTTP 内核、统一执行调度和 Web adapter，
接入现有协议/观察/CLI 链路；业务输入为 Subject，worker runner 把执行信号归入同一 Behavior。
先跑通双 CLI、monorepo 根到包依赖及连续复用，再完成 6 个 Objective、16 个 check、
生成器/脚手架/fixture/消费入口的全量迁移，无旧运行协议回退。

### I-S03: 验证失败边界与收益

验证并发启动、路径规范化、完整产物校验、按需加载/排空更新及在途版本冲突，
开始响应丢失、观察断开/重订阅、队列容量、明确取消和清理；
验证内核无需 HTTP 即可执行、多次采样/订阅不重复启动、当前快照与更新无竞态缺口，
正常及错误终态不被覆盖、业务依赖结果不丢失、HTTP 不生成第二个结果状态。
验证集合包含当前有权查看的活动任务，终态离开集合但在保留期内可单独观察，
摘要不泄露输入，终态过期/未知 ID 不重启任务。
连续混合 subject 的成功/失败/取消负载衡量内存、初始化、任务数退役及简单替补预热。
在写入秘密前建立并验证 discovery、启动锁和 descriptor/publication 的私有边界；
Windows 用实际 owner SID/受保护 ACL 验证，不依赖 chmod、umask 或本地化账户名称，
过宽既有目录/文件与权限后端失败均明确拒绝，不先写秘密再修权限。
执行针对性测试和 pnpm check，更新直接相关说明。

## Acceptance criteria

### I-AC01: 多请求复用且观察独立

多个 CLI 共用 Host，连续任务复用线程且全部迁移入口执行正确；
一次 IO 得到一个具有当前值的 Behavior，重复观察不重复执行，终态在观察作用域内可读；
单项和集合观察与同一执行表一致，断开观察不取消执行或影响其他观察者；
根检查返回业务依赖要求并释放线程，上层验证/处理包级目标后重新检查，
不伪造已满足证据，输入刷新、层级和问题归属正确；
无需预注册，同目录同 revision 复用，代码/资源变化更新 revision 后正确顺序切换。

### I-AC02: 生命周期和失败有界

队列/线程/消息/观察连接及状态保留容量有界，超时和明确取消不误伤他人；
清理失败不回池，不透明重试未知任务。任务数退役与预热不突破额度，
长期复用无请求资源持续累积，不以每请求重建替代清理。取消请求不直接宣告 Cancelled，
清理失败形成 Failed；作用域释放后状态及订阅引用可回收，不保留无限历史结果。
discovery 文件不向普通本机账户授予读写或替换权限；真实 ACL、恶意宽权限、
并发发布与失败回滚测试证明 Windows 边界，POSIX 保留实际 owner/private mode 校验。

### I-AC03: 校验和性能证据完整

相关测试、生成物及 pnpm check 通过，历史契约和固定证据不变，旧输入明确拒绝。
同环境固定输入比较进程/线程启动、初始化、内存及冷/热耗时，证明实际收益。
