# Implementation

本轮优先交付独立本机自查，分级及检查职责见 [分级与检查说明](./ideal/Levels-and-checks.md)。仓库实现位于 `objectives/pguide-self-check`；远程整备接入独立自查留作后续工作。下文保留稳定契约标题，记录实际设计，不代表父会话已批准验收。

复用现有 setup 的安装、配置、ACP readiness、受限进程执行与清理。新 sanity 不再使用旧 regulation fixture。此前结果见 [历史实现证据](./Verification.md) 和 [目标设备修订验证](./Target-revision.md)，均不证明新独立自查已经通过。本轮实现与验证边界见 [独立自查实现证据](./Self-check-implementation.md)，主会话的独立检查及真实认证阻塞见 [当前设备验证](./Local-device-validation.md)。另已建立并保留无凭据的 Linux 容器，正反例集成结果与复用入口见 [Docker 验证](./Docker-validation.md)；它不替代真实模型验收。

## Steps

### I-S01: 定义独立本机自查

建立独立的本机自查 Pilot、仅本机 subject 和使用指引，明确各级检查及缺少 pguide 时的外部 bootstrap 边界。

实际采用 `initial / installation → installed / configuration → configured / sanity → 隐式 terminal`。subject 不接收 target（包括 local/SSH）或 allowSanity，直接入口与 manifest 均拒绝；保留原有本机绝对路径、指定安装和可选版本/Agent/HOME 输入。

### I-S02: 复用检查并打通真实闭环

从现有实现复用安装、配置、ACP 和隔离任务验证；新自查默认执行一次直接 Agent 文件修复并独立核对随机内容，不嵌套完整 regulation，不增加 allowSanity 授权门。保留旧 setup/bootstrap 兼容行为，明确两种入口，解决预算与清理。

共享 helper 使用显式 selfCheck 模式；旧 setup 默认路径不变，含 SSH 传输和显式 allowSanity。新 sanity 仅创建独占 task/marker.txt，通过现有 AcpClient 的 initialize/newSession/prompt/stop API 执行一次提示，使用原有权限策略，不合成 grants、不增加 allow-all。正常 end_turn、未被拒绝且独立普通文件/链接数/字节数/随机精确内容校验通过才成功。

真实耗时诊断确认 sanity 原先先启动 readiness Agent，再为修复启动第二个 Agent。现已将 sanity 的协议、必需 sessionResume 能力及 session/new 核验合并到唯一修复会话；configuration 仍独立真实核验，不依赖历史成功。启动失败以 acp-unavailable 和安全 initialize/session-new、startup-failed 分类阻断，不发送 prompt；旧 setup 和 SSH 的 readiness 路径保持不变。没有放宽 24 秒 Pilot 上限、既有执行限制或清理余量。

为支持 dependency-free Git 子目录快照，构建脚本从共享源码提取 AcpClient 声明，并转译现有权限策略、进程树清理和流式脱敏模块，连同共享 helper 一并生成 runtime；不是另写一套线上 ACP。产物新鲜度纳入默认测试，源码变化后需 `pnpm self-check:build`。

Pilot 单项默认 20 秒，subject 上限 24 秒，为默认 30 秒 probe 留清理余量。直接 helper 最多 300 秒的诊断入口不构成 Pilot terminal 证据。总预算包括 readiness 与 prompt，内部取消先于外部期限预留 2.5 秒；原始 ACP 输出 192 KiB，外围执行输出 256 KiB。超限、超时和清理错误不成功，仅删除本次独占目录。

### I-S03: 验证并接入仓库检查

将独立自查和现有 setup 回归纳入默认检查，使用本机已安装的 pguide 和已有权限内的真实 ACP Agent 验证完整自查，不额外请求 sanity 级授权。

仓库增加 manifest/wiki、输入、单 prompt、假完成/错误内容/权限拒绝/不完整结束、输出上限、超时清理、Git 子目录快照回归；原 setup 测试继续覆盖本地、SSH 与旧授权语义。部署验证脚本新增安装后 self-check 快照路径，fixture 明确只用于自动回归，不冒充真实模型证据。

源码 `811f28d802028b8c5a82337a47f9b111d83cedb6` 的 Windows 子会话定向复跑 8/8 通过，父会话独立验证同版本干净安装容器正反例。继续同步上游 Windows 修复后，父会话又在 `fbccc9de7e9ba909771d21aff1a0410d1d96ccbe` 执行 pnpm check，退出 0，354 项测试中 353 通过、1 项已有平台跳过；实际执行和 Turbo 缓存边界见 [Docker 验证](./Docker-validation.md)。历史 Windows 失败不再列为当前未解决阻塞。

历史设备固定 811f28d 的完整 probe 停在 installed，configuration 的 session/new 被 Agent 拒绝，认证诊断为 authentication-required。当前 Windows 用户另用既有安装加载固定 c1f2a42 的新 package 快照，完整 probe 已进入 direct sanity，但返回 504 `timeout: direct Agent exceeded its deadline.`。用户随后明确同意单次绝对 marker 写入授权，本机指定固定 6c75d92 再执行一次完整 probe；无秘密方法审计确认真实 prompt 已发出，在约 13.5 秒等待后因剩余预算耗尽取消，没有权限请求，仍未得到 terminal。临时配置及授权启动器已删除，scratch 已清空。不同用户的历史认证阻塞、客户端权限模拟和当前真实结果不能混用；readiness 通过或 prompt 发出也不等于真实修复成功。详细纠正、边界及下一步见 [当前设备验证](./Local-device-validation.md)。本步骤和 I-AC03 保持未完成，不记录 submitInner 或 acceptInner。

随后从无 prompt 的 ACP 元数据确认默认模型及可选 `gpt-5-mini`，仅在临时 profile 切换轻量模型；原实现仍超时。消除 sanity 的重复 readiness 启动后，完整 pnpm check 通过（365 项报告，363 通过、2 项跳过）；固定已同步优化源码 7f1487a 的真实复验确认完整自查只启动两个 ACP Agent，唯一 prompt 获得约 17.2 秒，但仍返回取消和 504，未达到 terminal。没有延长预算、扩大权限或继续重试；I-S03、I-AC03 仍未完成，等待新的外部执行证据或预算契约讨论。

按用户后续要求，已同步最新代码并新增独立真实 Agent Docker 基线，先证明 Agent 能正常完成隔离文件任务，再进行后续 pguide 自查；不再把模型目录或握手视为模型可用。既有默认无凭据 fixture 镜像保持不变，另有显式 real-agent target 安装固定 Copilot CLI，以容器内正常登录获得独立认证，不复制宿主 token、HOME 或用户配置。只有真实任务明确 end_turn、没有权限拒绝、随机 marker 经独立核验且清理成功才能返回 ready；120 秒诊断基线不修改 24 秒 Pilot 限制，也不替代 terminal。镜像与容器已构建、启动，首次零 prompt 探测明确返回 authentication-required。用户要求主会话启动官方设备码流程后，浏览器授权成功，但 CLI 因缺少 keychain 且未确认明文存储而未保存 token；当前等待明确的存储选择及完成登录，见 [Docker 验证](./Docker-validation.md)。本轮 pnpm check 通过（369 项报告，367 通过、2 项跳过）；I-S03、I-AC03 仍未完成。

## Acceptance criteria

### I-AC01: 独立自查可加载

Pilot 加载与分级测试证明 initial、installed、configured 和隐式 terminal 的行为符合说明；本机 subject 不依赖 SSH，文档说明外部 bootstrap 入口。

### I-AC02: 自查不误报就绪

自动测试覆盖缺安装、错配置、ACP 失败、工具权限拒绝、假修复、超时和清理；证明新自查无额外授权时正常执行、至多一次 Agent 调用且不嵌套 regulation，只有真实任务及独立文件复查成功才能 terminal，旧 setup 回归保持通过。

### I-AC03: 自动及真实验证通过

pnpm check 通过，并有本机已安装 pguide 运行独立自查达到 terminal 的真实证据；若 Agent 或模型不可用，明确保留阻塞，不用测试替身替代，不因低损耗而扩大权限或自动重试。
