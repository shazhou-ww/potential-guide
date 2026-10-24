# Implementation

## 本次修订（2026-10-24 npm 包模型准备）

当前按 [新设计](./ideal/Design.md#11-npm-包身份与固定绑定) 重新准备；
本轮只更新契约，尚未修改产品实现。I-* / D-* 因要求变化全部重置，
不是撤销旧验收事件，也不把旧通过结果包装成新范围已完成。
旧版本 `0ae8c1991182` 的实施已由用户接受，以下结果只适用于该基线，
详见 [Checkpoint 6](./Implementation-evidence.md#checkpoint-6跨平台验证与实施候选2026-10-23)。

- 无 HTTP 内核、worker 调度、四路由、CLI discovery 与业务依赖结果处理均已接通；
  6 个 Objective、16 个入口完成迁移，无旧协议回退。
- 修复了 POSIX 强杀后未确认退出、并发 discovery 多启动，以及原子发布期间权限扫描
  误判已删除 metadata 的实际缺口；attached 子进程也在清理范围内。
- setup/self-check 与 health 使用每次请求的显式环境，不继承共享 Host 首次启动的
  PATH/HOME/配置路径；嵌套 CLI 保留隔离 Host 位置，不转发任意环境变量。
  Host cwd 固定在私有目录，测试清理等待自身拥有的并发连接与有界 OS 锁释放。
- Windows Node 24.12.0 与 Ubuntu/WSL2 Node 24.14.1 的 Host suite 均无失败：
  28 项分别为 27 通过/1 POSIX 跳过、26 通过/2 Windows 跳过；Linux 实际 owner/mode、CAS、
  独立进程竞争、锁持有者崩溃和六轮 discovery 恢复均已执行。
- 最终 `pnpm check` exit 0：Turbo 44/44、root tests、18 包打包、
  10 组隔离消费及全部 16 个 tarball worker 入口通过。
- 同一轮真实 CLI 测量 cold 17.00 s、每次新服务 median 20.02 s、
  共享 hot median 3.70 s；shared 7 次 CLI 始终只初始化 2 个 worker。
  冷后完整服务 RSS 253.80 MiB，包含 Windows 权限 helper。

原 checkpoint 5 的 Windows ESRCH 断言本轮定向、全量和额外连续五次均未复现，
未放宽断言；其历史根因仍未知，不将新发现的 POSIX 缺口冒充为该失败的根因。
POSIX 证据来自实际 Linux/WSL2，不外推到所有 POSIX 系统；512 次负载和短时 RSS
不能证明无限期无泄漏，也不证明冷启动或绝对内存优于旧架构。
此前危险清理的历史影响仍未知，本轮验证不等于历史环境完整性结论。

## Steps

### I-S01: 收敛协议与所有权

接通 package.json.name 作为 Objective 身份、完整包内容 digest 作为 ObjectiveRevision，
保留唯一包根 objective.yaml。复用 npm 标准 dependency spec，准备时解析和固定，
移除 Pilot 更新监听但保留业务观察。对齐声明、加载器、协议、Coordinator 请求/结果/
持久化重放的包名与版本，记录来源并明确旧 Git 证据的兼容/显式迁移。
固定 digest 编码、算法版本及跨平台测试向量；包 digest 与 check hash 分层，
semver、commit、lock/integrity 不冒充内容身份。

按 [最小设计](./ideal/Design.md) 定稿目录/revision、自包含产物、worker 消息和开始/取消/观察接口，
以 `executeCheck :: WorkerDirectory -> Revision -> Subject -> IO (Behavior CheckState)` 为不动点，
明确单项当前状态、终态及活动集合的采样/订阅；HTTP 只做投影，
不添加注册、会话或 Host 管理接口，观察连接不拥有执行寿命。
内置 check 通过 CheckResult 返回 Objective/subject/level 依赖要求，上层处理并校验实际事实，
不将依赖字段、回调或递归调度编码进 Host 协议。
明确容量、任务数退役与预热额度，不建设任务恢复平台或两套队列/状态源。

### I-S02: 接通共享 Host 与检查器

沿用 packages 下的可复用 Host 包，在包内分离无 HTTP 内核、统一执行调度和 Web adapter，
接入现有协议/观察/CLI 链路；业务输入为 Subject，worker runner 把执行信号归入同一 Behavior。
先跑通双 CLI、monorepo 根到包依赖及连续复用，再完成 6 个 Objective、16 个 check、
生成器/脚手架/fixture/消费入口的全量迁移，无旧运行协议回退。
将现有业务 Objective 拆为六个单 Objective npm 包，独立 package-standard 和 marker；
源码/原始资源入 Git，bundle 与复制资源改为忽略的构建输出，按 pack 交付。
准备端物化私有不可变包/check 目录，处理 pnpm 硬链接，不向 Host 引入 npm 或隐式安装。
检查 Node 子进程与 Wasm 的资源交付、平台前提和清理接线，更新直接相关发布说明，
不执行发布。先验证新消费再移除当前生成物跟踪，不改写历史。

### I-S03: 验证失败边界与收益

覆盖 registry/version/range/tag/alias、Git、tarball 与 local spec 的真实解析和离线固定恢复，
冲突来源/包名不匹配/篡改/脚本拒绝均明确失败；验证显式刷新前后绑定与证据隔离，
同字节重打包摘要相同、内容改变摘要不同，以及六包十六入口的干净构建/pack 消费。
定位旧消费记录中的默认 5 秒冷初始化超时与启动中 shutdown 原生断言，
建立不延长预算、不依赖预热成功掩盖冷态失败的回归证据。
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

六个 npm 包各有一个根定义，以实际包名唯一标识 Objective；包摘要覆盖完整交付内容，
固定绑定贯穿声明、依赖、Coordinator、CLI 和恢复。自动更新不改变运行中的判定标准，
显式更新需要新事实，包 revision 与 Host check revision 可独立变化且可追溯。
通过协议、digest、加载器和 Coordinator 持久化测试证明，不以 Git commit 代替摘要。

多个 CLI 共用 Host，连续任务复用线程且全部迁移入口执行正确；
一次 IO 得到一个具有当前值的 Behavior，重复观察不重复执行，终态在观察作用域内可读；
单项和集合观察与同一执行表一致，断开观察不取消执行或影响其他观察者；
根检查返回业务依赖要求并释放线程，上层验证/处理包级目标后重新检查，
不伪造已满足证据，输入刷新、层级和问题归属正确；
无需预注册，同目录同 revision 复用，代码/资源变化更新 revision 后正确顺序切换。

### I-AC02: 生命周期和失败有界

准备脚本/包来源在授权边界内，check 不隐式安装；独立包/check 物化不绕过权限/链接校验。
冷态首次初始化和启动中退出回归通过，先前原生断言与超时有定位和修复证据，
不以热态重跑或放宽预算替代。

队列/线程/消息/观察连接及状态保留容量有界，超时和明确取消不误伤他人；
清理失败不回池，不透明重试未知任务。任务数退役与预热不突破额度，
长期复用无请求资源持续累积，不以每请求重建替代清理。取消请求不直接宣告 Cancelled，
清理失败形成 Failed；作用域释放后状态及订阅引用可回收，不保留无限历史结果。
discovery 文件不向普通本机账户授予读写或替换权限；真实 ACL、恶意宽权限、
并发发布与失败回滚测试证明 Windows 边界，POSIX 保留实际 owner/private mode 校验。

### I-AC03: 校验和性能证据完整

从无入库 bundle 的干净源码构建六包十六入口并独立消费；相关测试、产物校验和
pnpm check 通过，旧输入/历史来源按明确兼容或迁移规则处理，不改写固定证据。
真实包来源与 Node/工具链固定，比较进程/线程启动、初始化、内存及冷/热耗时，
证明复用收益与准确包内容身份；无 npm 发布或生产操作。
