# Deployment

本文件是可调整的外部验证初版，不属于构想验收范围，不授权 npm 发布。
本轮以 Windows x64 / Node 24 的仓库外自有隔离消费目录验证；
只使用本次真实打包并安装的 tarball、公开入口和自有 loopback HTTP/HTTPS 服务及文件制品。
验证方案及可复验驱动见 [外部验证方案](./ScenarioPlan.md)；实际结果另行记录，不用单元测试替代部署观察。

实施使用 SQLite/Facts v3；外部服务必须选择新的数据库路径，旧库只读拒绝，
不迁移、覆盖或删除现有用户数据。消费制品必须包含编译后的 Node 类型守护模块，
使用新 Result/evidence 与 matchPolicy/Run 字段；不能把旧脚本的成功形状当作兼容 fallback。
自定义宿主资源注册必须明确声明请求级 resourceLifetime，或提供跨请求所有权的独立
confirmResourceRelease；动作上下文使用可信 workerGeneration，不把 callback 返回当所有句柄已释放。

## Steps

### D-S01: 验证独立消费者的完整复用

在操作自有的独立消费环境验证 Check/Probe 完整过程共享，
观察准备中的需求、浮动引用内容变化及 Run 终结结果，
核对 matchPolicy 字段及 Run / Execution 公开命名，不使用仓库源码替代实际消费制品。
分别在 Check 和 Probe 的真实制品准备尚未结束时加入 terminated-policy 需求，
改变同一浮动 URL 的制品内容；Checker 使用自有 HTTPS，Objective 使用自有 file URL，
观察共享 Run 仍返回已固定的旧内容。证书只加入当前自有 Node 进程，不修改系统信任库。
另用精确 digest 的新需求与错误 digest 验证身份边界，保留业务结果、准备证据、请求及事件。

### D-S02: 验证访问与生命周期边界

以独立服务调用验证 scope 隔离、资源拒绝、取消、超时和恢复，
核对实际结果内容及公开事件；记录消费方式和兼容性影响，不默认修改现有用户数据。
在自有环境验证类型 Worker 故障、指定执行取消及按需恢复，区分正常重启与执行重跑；
核对消息中仅有必要数据及 Engine 状态不受插件内部变更干涉，不扩展为信息安全攻击测试。
对具有业务消息的独立消费者验证追加、目标调整、重复投递与终结竞争，
对 Never Message Schema 消费者验证拒绝任意业务 payload 但仍可取消；
具体 Regulator 消费环境须按已实现契约选择，不虚构已注册的通用 Regulator 类型。
以独立已安装类型验证 Never 消息与指定取消、业务消息投入追加及同 ID 幂等、
目标明确拒绝且不覆盖另一共享需求、deadline 不续期及终结竞争。
自有故障消费者观察 Worker crash/hang 时 Engine HTTP 仍响应、按需新代际不重跑旧 Run；
已知宿主动作/句柄清理证明未结束时无 reclaimed 或 waitForTaskRelease 提前成功。
以自有新 SQLite 路径跨真实 Node 进程重启，核对 Check/Probe 原结果和业务历史复验。
所有启动的自有 child/server/Worker 按 handle/PID 清理，记录强制清理不等于业务回收证明。

## Acceptance criteria

### D-AC01: 实际结果遵循完整尝试语义

独立消费者能观察兼容需求共享准备与执行，以及实际使用的 Checker 内容身份；
浮动 URL 不被宣传为最新版本，Match Policy 的事件属于完整 Run 而非 Execution 子阶段，
公开命名与文档一致。
证明依据包含制品 SHA-256/内容 digest、实际 installed 路径、执行命令与输出、
准备门闩、共享 runId 和旧内容/精确版本事件，不以既有 pack:check 代替本轮观察。

### D-AC02: 外部边界与记录一致

通过独立服务拒绝与恢复案例证明服务访问和实际资源动作仍受控，
单个需求退出不破坏共享过程，保留可复验的制品身份、调用和事件证据。
类型故障不终止 Engine，取消指定执行不误杀同类型其他执行；
明确内存状态隔离与残留资源处置，未知执行不被自动重跑。
输入消息接纳可查询，重复投入不重复扣记，追加不续期，
某参与者调整目标不让其他需求错误完成，已终结 Run 不因消息复活。
保留故障/资源等待/跨进程恢复的实际事件证据；限定平台、OS 副作用及未注册生产
Regulator 等残余未知明确列出。发现真正实现 bug 时交回父代理，不修改已接受 inner 绕过审查。
