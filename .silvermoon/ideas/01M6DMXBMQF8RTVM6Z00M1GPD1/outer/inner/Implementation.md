# Implementation

主 Agent 复核发现 Run sharing 错用全 Input canonical，偏离既有 Schema Equals 共识。
先前无保留 ready 结论已撤回，六个 I-* 先重置；本次恢复 Schema Equals 并完成修复后验证后才勾回。
实时预约与事实投影共用既有 Schema 编译投影，原 Schema 持久在 Binding，历史 key 可重建且不成为独立权威。
原始完整 Request canonical 幂等冲突检查不变；修复后的定向、八包 338/338 与完整 `pnpm check` 均实际 exit 0。
主 Agent 随后独立复验暴露 CLI/Worker 时序失败；已按真实握手/条件等待修复，
并修正再次全仓检查暴露的 SSE reader 取消所有权缺口。最新完整 `pnpm check` 实际 exit 0，
负对照、失败试跑及最终日志独立记在 Fact-stage 时序小节，不以旧通过覆盖新失败。
既有独立 Run Worker 阶段保留为[历史阶段证据](Worker-stage.md)，不替代当前完整验证。
[匹配资格的时间观测边界](Matching-observation-boundary.md)的 Q08 已随准确 Ideal
`564f6709fc0c7c2d152777520b7a9cf49d7aeb94` 经主 Agent 按授权接受，核心事实模型已继续实施。
当前源事实、完整 Run 退出、准入持久下界和观察链路的代码与分层证据见
[事实模型实施证据](Fact-stage.md)：保留旧候选 306 用例的历史记录，并单列本次修复后的命令和实际退出码，
包含真实生产 tarball/独立消费者验证。D-* 未勾选。
上述是先前 Inner 候选的历史证据。主 Agent 后续已同步候选 `31ba74b0`，
接受 Inner `51a9212036d4` 并开始 Outer；真实 Chrome 冒烟暴露 UI 仍冻结时间、
禁止终态首次取消及取消文案混淆 Run 结局。当前按明确授权只回修 Inner：
恢复按 now 独立推算时间、终态首次取消、取消后 stage 继续推进，并更新原生浏览器反例。
三个 I-AC 已先重置；本轮定向 6/6、完整 Chrome 与新候选完整 `pnpm check` 均实际 exit 0，
完整验证后才勾回；命令、失败试跑及原生证据路径另记于 Fact-stage。
不以旧接受/旧 tarball 验证代替新候选证据，不修改 Ideal、Outer 计划/证据或 events。
本轮不提交、推送、追加生命周期或自行越过重新 submit/acceptInner。

主 Agent 随后同步修复 `59643dbb`、重新接受 Inner `fd81e6762dce`；
Outer 计划 `1cdf67c4` 的原生 Chrome 又暴露 fixture 将整段列表 textContent 当作静态不变量。
本轮只修 fixture/精准测试，不改产品：等待完整实时基线，再比较实际查询请求、成员/顺序、
行与控件身份、用户草稿、宽度和滚动；主动加入合法源增量，必须允许状态/水位/时间文本更新。
相关 I-AC02/I-AC03 先重置，定向 UI 12/12、format/lint/typecheck 与连续两个新 profile
完整 Chrome 均实际 exit 0 后勾回；未重跑全 pack。失败及两次证据路径见 Fact-stage，
不以该修复代替主 Agent 对新 Inner 的再次门禁。

## Steps

### I-S01: 对齐协议与核心运行语义

依据准备阶段确认的差异收敛数据域、状态、匹配、终止和恢复；保持业务实现与 Engine 的职责边界。
先隔离每个完整 Run 的 Worker，区分可靠结果、实际退出和宿主资源回收；
再替换旧权威 Task snapshot/绑定事件路径，以事实与时间推导三维状态、唯一匹配及停止/恢复裁决。
按重新接受后的 Q08 验证已提交资格边界与单个 observedAt 见证，不增加独立绑定动作或每 tick 时间日志。

### I-S02: 对齐持久事实与观察接口

对齐受理幂等、事件 revision、查询分页、订阅补读及集合派生事件，并适配直接消费者。
持久化单调准入下界，明确拒绝不支持的旧格式且保留旧库；贯通独立 Run 观察、
完整源事件封装及 HTTP/Server/Check/Probe/UI，不以旧接口改名或成功形截断代替实现。

### I-S03: 验证契约与业务回归

复用现有协议、运行和分层测试，增加必要的时间、竞态、退出、恢复和增量一致性场景；运行相关测试及 `pnpm check`。
测试 fixture 的结果必须经过真实 Worker 退出边界；紧耦合等待改为等待事实，不放宽结果断言。

## Acceptance criteria

### I-AC01: 核心契约可验证

通过定向测试验证独占、状态推算、唯一匹配、停止与恢复；记录每个场景对应的契约。

### I-AC02: 观察与幂等保持一致

通过并发提交、窗口边界、分页和断线补读测试证明不重复受理、不静默丢事件、不伪造完整结果。

### I-AC03: 集成与质量检查通过

八个 workspace 的直接链路符合新协议，相关测试及 `pnpm check` 通过；基线问题与改动引入的问题分开记录。
