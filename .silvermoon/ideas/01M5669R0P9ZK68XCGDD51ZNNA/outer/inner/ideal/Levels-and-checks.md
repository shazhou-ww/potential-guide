# 本机自查优先：分级与检查说明

本文支撑 [Idea.md](./Idea.md)，说明目标行为，不构成另一份独立契约。
本轮只调整目标及计划，尚未实现独立的本机自查 Objective；下列目标不能当作现有功能或验证证据。

## 两个 Objective 的职责

| Objective | 执行位置 | 职责 | 完成依据 |
| --- | --- | --- | --- |
| 本机自查（本轮优先） | 被检查设备本机 | 用本机已安装的 pguide 检查安装、配置、ACP 和真实任务能力 | 本次自查达到 terminal |
| 远程整备（后续接入） | A 上的控制 Agent，通过指定通道操作 B | 按授权补齐 B 的运行环境、安装和配置，最后调用 B 的本机自查 | B 的 pguide 运行本机自查达到 terminal，且 A 验证结果属于指定 B |

自查不是自动修复安装配置的流程。自查失败后，由用户或整备 Agent 根据问题采取动作，再重新自查。
缺少 pguide 时不能让不存在的 pguide 自己运行自查：先使用现有外部 bootstrap 检查或整备，再进入正式自查。
在已具备 pguide 的设备上，自查仍需核验所指定的安装与版本，不能仅因调用成功就跳过安装检查。

## 本机自查的输入与证据边界

- 输入描述本机的工作目录、用户配置路径、隔离目录、pguide 入口，以及可选目标版本和 Agent。
- 所有路径、配置合并上下文、环境与认证均属于当前被检查设备和用户，不包含 SSH target，也不接收控制机的认证副本。
- 真实任务检查需要明确的 allowSanity 授权及有界执行预算；授权不意味着无限重试或能够保证具体计费金额。
- 结果证明本次指定设备、用户、配置和版本下的状态，不是永久就绪凭证。

## Levels 总览

Level 表示已确认的状态；该级的 advancement check 检查能否进入下一级。
每个显式 level 只有一个 check，terminal 为隐式完成态，没有下一项 check。

```text
initial
  └─ installation 通过 → installed
       └─ configuration 通过 → configured
            └─ sanity 通过 → terminal
```

| Level | 已确认的状态 | 该级 Check | 通过条件 | 下一状态 |
| --- | --- | --- | --- | --- |
| initial | 尚未确认所指定 pguide 安装可用，不等于断言未安装 | installation | 安装入口可执行、版本响应有效，且满足显式目标版本 | installed |
| installed | 安装及版本已确认，配置与 Agent 尚未确认 | configuration | 配置及子命令有效，选定 ACP Agent 的真实初始化和会话建立成功 | configured |
| configured | 配置和 ACP 无 prompt 会话已确认，实际推理与修复能力尚未确认 | sanity | 已授权真实任务执行成功，独立观测和文件内容复核均通过 | terminal |
| terminal（隐式） | 本次完整自查通过 | 无 | 不再推进下一项检查 | 无 |

后续检查复核其依赖的安装和配置，不把前一次通过当作永久缓存。
未通过当前检查就停留在相应状态；输入、通道、协议或超时故障表示未取得有效观测，不能解释为通过。

## initial / installation：安装能否使用

检查内容：

1. 执行指定的本机 pguide 入口，读取结构化版本响应。
2. 验证响应的身份、格式及非空版本，不能只看进程退出码或 help。
3. 若指定 desiredVersion，要求精确匹配；版本号本身不证明源码 commit 一致。

通过后进入 installed；此时不声称配置、认证或模型可用。
缺少入口、不可运行和版本不匹配分别应明确暴露；响应格式错误属于调用/协议故障，不伪装成安装成功。

## installed / configuration：配置与 Agent 能否接通

检查内容：

1. 复核 installation，并确认所指定用户配置文件存在、有效配置可读取。
2. 检查 config、probe、regulate 的命令发现结果，要求兼容且无冲突。
3. 按显式 agent 或 defaultAgent 选出实际 profile，确认 ACP stdio 配置及必需环境引用有效。
4. 启动真实 Agent 进程，执行 ACP initialize；在线协议使用数字版本并验证协商结果。
5. 执行 session/new，要求得到有效 sessionId；不发送 session/prompt。

通过后进入 configured，仅证明可建立协议会话，不证明真实模型推理成功，也不证明有权限完成任务。
缺配置、错误配置、缺子命令、缺 Agent、缺环境变量或 ACP 拒绝/不可用均需明确暴露。
本轮仅验证 ACP stdio；AHP profile 不在范围内，不能静默换用其他 Agent。
若 Agent 在初始化或建会话时本身会产生费用，需要先明确其行为，不能承诺该阶段绝对免费。

## configured / sanity：能否完成真实执行闭环

检查内容：

1. 首先检查显式授权；没有 allowSanity 时不启动真实任务，不将“未执行”当作成功。
2. 复核安装、配置和 ACP readiness，在本机独占 scratch 中建立临时 Git fixture，不修改真实项目。
3. 放置错误 marker，并以独立 probe 先确认缺陷确实存在。
4. 用本机已安装的 pguide 执行一次有界 regulation，由选定的真实 Agent 修复该小任务。
5. 从固定 fixture revision 再独立 probe，并直接核对随机 nonce 的精确文件内容，不能只相信 Agent 摘要或 regulate 报告。
6. 在有界执行结束后清理本次拥有的临时配置、状态及 fixture；超时、输出超限和清理异常不得伪装成成功。

只有真实任务和独立复查均通过才进入 terminal。
未授权、缺 Git、Agent 无法推理、额度耗尽、未修复或内容不符都不能达到 terminal；
业务问题与调用故障应分别返回结构化结果。
临时隔离不是对恶意全权限 Agent 的安全沙箱，操作系统强杀或断电也不能保证自动清理。

## 自查与小任务不能递归

```text
设备上的 pguide
  └─ 本机自查 Objective
       └─ sanity
            └─ 独立的小型修复 fixture
```

小型 fixture 只检验一个可独立验证的修复结果，不得再次运行完整本机自查。
已有 setup sanity 中的 marker 修复可作为复用基础，但它本身不是完整设备自查。

## 后续远程整备如何使用自查

远程整备本轮不新增或承诺一套已实现的 levels。后续接入时需满足：

1. A 先确认明确指定的 B、连接授权和主机信任，再按授权补齐 B 的前置条件与配置；B 没有 Node 或 pguide 时不能要求 B 先运行正式自查。
2. 最终检查通过远程通道调用 B 已安装的 pguide，由它运行固定版本的本机自查 Objective，而不是 A 运行自己的本机自查。
3. A 核对结构化结果确实来自本次指定 B 的执行，关联目标身份、用户/配置上下文、自查版本及结果；仅退出码为零或 Agent 文字不构成通过。
4. B 的自查达到 terminal 才能作为整备完成证据；缺结果、调用故障、未授权或超时均不得回退为 A 本机成功。
5. 预算覆盖远程调用、本机自查及内层任务，并为终止与清理留出余量；不复用旧成功缓存绕过当前检查。

## 与现有实现的关系及已知风险

- 现有 [setup manifest](../../../../../../objectives/pguide-setup/pilot.yaml) 已有同名的三个 checks 和上述分级，但本机与 SSH 目标仍放在同一个 setup Objective 中；独立自查尚待抽取。
- 现有 [setup 说明](../../../../../../objectives/pguide-setup/README.md) 包含 bootstrap、SSH、认证与超时规则。调整后本机自查拥有统一就绪标准，远程整备负责安装配置与结果转交，不能复制第二套验证逻辑。
- 现有 Pilot wrapper 要求总预算不超过 24000 毫秒；SSH 还需预留 10000 毫秒，所以 helper 预算不超过 14000 毫秒。真实 Agent 冷启动可能超出预算，独立自查的外层期限必须在实现时明确解决，不能以直接 helper 的长时成功冒充 Pilot terminal。
- [历史目标设备验证](../Target-revision.md) 中真实模型访问曾失败。该记录不是当前设备或新独立自查的通过证据；新实现仍需自动回归和已授权真实验证。
