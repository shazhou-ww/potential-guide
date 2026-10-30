# 将 Probe 接入统一任务服务

## 问题

Check + Server MVP 只执行单个 Checker，尚不能通过统一任务接口观察 Objective 的等级、问题与动态依赖。

## 结果

在 [Check + Server MVP](../../../../01M65ABHR94EQ14NYTGZAWRRV3/outer/inner/ideal/Idea.md) 完成后交付 `@potential-guide/probe-task`，
注册 `type=probe`，组合独立子 Check 的结果，供同一服务和进程内调用方消费；本项完成后再推进 Regulate。

## 边界

- 复用[通用引擎](../../../../../../docs/task-engine.md)和现行 Objective 制品规则，不新增 Objective Host、业务专用任务状态机或通用前置条件解锁；新协议不以旧 Host 字段为约束。
- Probe 仅观察，不运行修复 Agent，不将动态 requirements 变成治理授权；子任务的调用、关联、取消和证据属于业务组合，不能修改引擎通用事件外壳。
- 保持准确根与依赖引用、等级和问题语义；不包含 Regulate、Release 发布、全量旧入口迁移或独立文档查询服务。旧重构草案仅为来源，历史验收不重开。

## 验收标准

- 独立消费者经同一 Server 提交 Probe，获得准确 Objective 的等级、问题、依赖需求和可追溯子 Check 证据；业务未达标不是执行故障。
- 父子任务遵守一致的时间与取消边界，低容量下仍能推进，不因父任务等待占满子任务资源而死锁，不误伤共享执行的其他 owner。
- 进程内与 HTTP/SSE 的结果、历史和恢复一致；Probe 不触发修复，重启不以重新观察冒充原执行结果。
