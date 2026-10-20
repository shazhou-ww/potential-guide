# Implementation

本轮优先交付独立本机自查，分级及检查职责见 [分级与检查说明](./ideal/Levels-and-checks.md)。仓库实现位于 [pguide-self-check-pilot](../../../../../packages/pguide-self-check-pilot/README.md)；远程整备接入独立自查留作后续工作。下文记录实际实现与证据，不代表用户已批准验收。

复用现有 setup 的安装、配置、ACP readiness、受限进程执行与清理。新 sanity 不再使用旧 regulation fixture。历史过程见 [历史实现证据](./Verification.md)、[目标设备修订验证](./Target-revision.md)、[独立自查实现证据](./Self-check-implementation.md) 和 [当前设备验证](./Local-device-validation.md)。最新自动回归、容器独立认证及真实完整 terminal 证据以 [Docker 验证](./Docker-validation.md) 最后一节为准，既有 fixture 成功不替代真实模型证据。

## Steps

### I-S01: 定义独立本机自查

建立独立的本机自查 Pilot、仅本机 subject 和使用指引，明确各级检查及缺少 pguide 时的外部 bootstrap 边界。

实际采用 `initial / installation → installed / configuration → configured / sanity → 隐式 terminal`。subject 不接收 target（包括 local/SSH）或 allowSanity，直接入口与 manifest 均拒绝；保留原有本机绝对路径、指定安装和可选版本/Agent/HOME 输入。

### I-S02: 复用检查并打通真实闭环

从现有实现复用安装、配置、ACP 和隔离任务验证；新自查默认执行一次直接 Agent 文件修复并独立核对随机内容，不嵌套完整 regulation，不增加 allowSanity 授权门。保留旧 setup/bootstrap 兼容行为，明确两种入口，解决预算与清理。

共享 helper 使用显式 selfCheck 模式；旧 setup 默认路径不变，含 SSH 传输和显式 allowSanity。新 sanity 仅创建独占 task/marker.txt，通过现有 AcpClient 的 initialize/newSession/prompt/stop API 执行一次提示，使用原有权限策略，不合成 grants、不增加 allow-all。正常 end_turn、未被拒绝且独立普通文件/链接数/字节数/随机精确内容校验通过才成功。

真实耗时诊断确认 sanity 原先先启动 readiness Agent，再为修复启动第二个 Agent。现已将 sanity 的协议、必需 sessionResume 能力及 session/new 核验合并到唯一修复会话；configuration 仍独立真实核验，不依赖历史成功。启动失败以 acp-unavailable 和安全 initialize/session-new、startup-failed 分类阻断，不发送 prompt；旧 setup 和 SSH 的 readiness 路径保持不变。复用会话本身不改变任何期限、权限或清理余量；显式预算的规则如下。

为支持 dependency-free Git 子目录快照，构建脚本从共享源码提取 AcpClient 声明，并转译现有权限策略、进程树清理和流式脱敏模块，连同共享 helper 一并生成 runtime；不是另写一套线上 ACP。产物新鲜度纳入默认测试，源码变化后需 `pnpm self-check:build`。

Pilot 单项默认仍为 20 秒，外层 probe 默认仍为 30 秒。用户同意增加显式可配置的较长预算后，subject 上限为 300 秒，但必须满足本项 timeoutMs 加 6000ms 不超过外层实际期限；默认外层下仍最多 24 秒，较长值必须显式协调本次配置的 regulationStrategy.probe.timeoutMs，不自动改默认值或重试。沿用旧本机 setup 的元数据格式校验及清理余量规则，SSH 既有上限保持不变。直接 helper 最多 300 秒的诊断入口不构成 Pilot terminal 证据。总预算包括 readiness 与 prompt，内部取消先于外部期限预留 2.5 秒；原始 ACP 输出 192 KiB，外围执行输出 256 KiB。超限、超时和清理错误不成功，仅删除本次独占目录。

### I-S03: 验证并接入仓库检查

将独立自查和现有 setup 回归纳入默认检查，使用本机已安装的 pguide 和已有权限内的真实 ACP Agent 验证完整自查，不额外请求 sanity 级授权。

仓库增加 manifest/wiki、输入、单 prompt、假完成/错误内容/权限拒绝/不完整结束、输出上限、超时清理、Git 子目录快照回归；原 setup 测试继续覆盖本地、SSH 与旧授权语义。部署验证脚本新增安装后 self-check 快照路径，fixture 明确只用于自动回归，不冒充真实模型证据。

预算候选的定向十项回归全部通过；完整 pnpm check 退出 `0`，373 项报告中 371 通过、2 项已有平台跳过、0 失败。setup 33 项、self-check package 1 项、monorepo 34 项和根脚本 24 项实际执行，其余九个 workspace 的测试复用缓存；格式、lint、类型、四个 runtime 新鲜度、build 和 pack 均通过。默认和显式较长预算的 Git 快照 terminal、非法/不足外层期限、假修复、拒绝、超时清理及更短 Agent 期限均有回归覆盖。

独立 Linux 容器 `pguide-agent-keychain-1ce0ed16` 已用官方流程获得自己的认证，采用加密 Secret Service，不复制宿主 token 或 keyring。先证明真实 `gpt-5-mini` baseline ready，再由该设备上已安装的 `pguide 0.4.0-rc.0` 加载已同步源码 `7db27d869ed33dd0cac526bc5cf9321f6c3891df` 的 Pilot 快照。容器导入前后 Pilot Git tree 精确相同，快照 revision 为 `85d1b2a5f73e7a7cb4e9d1fb2e335f9ee52fbb1a`；已安装 CLI 的构建来源独立记录，不混称同一个源码 commit。

本次显式 subject 60000 ms / 外层 probe 90000 ms、零重试的完整真实 probe 返回 status `200`、`terminal`、空 problems、精确版本匹配；只发出一次 prompt，真实 end_turn，随机文件由检查程序独立核验，scratch 清空且无关 sentinel 保留。主会话另直接读取原始 probe、配置、subject 和安全方法审计复核，不只相信验证器摘要。真实修复会话约 8.5 秒完成 startup，约 29.4 秒正常结束；没有以长 helper 或独立 baseline 冒充完整 terminal。

I-S03 与 I-AC03 的 Agent 可验证工作现已完成，可以提交精确 Implementation revision 供用户验收。结论限于该已认证 Linux 容器、所选模型和显式预算，不声称默认 20/30 秒配置、Windows 宿主、远端 SSH 或其他设备也已通过。用户验收、后续交付及默认预算行为保持独立；不得自动记录 acceptInner。

## Acceptance criteria

### I-AC01: 独立自查可加载

Pilot 加载与分级测试证明 initial、installed、configured 和隐式 terminal 的行为符合说明；本机 subject 不依赖 SSH，文档说明外部 bootstrap 入口。

### I-AC02: 自查不误报就绪

自动测试覆盖缺安装、错配置、ACP 失败、工具权限拒绝、假修复、超时和清理；证明新自查无额外授权时正常执行、至多一次 Agent 调用且不嵌套 regulation，只有真实任务及独立文件复查成功才能 terminal，旧 setup 回归保持通过。

### I-AC03: 自动及真实验证通过

pnpm check 通过，并有本机已安装 pguide 运行独立自查达到 terminal 的真实证据；若 Agent 或模型不可用，明确保留阻塞，不用测试替身替代，不因低损耗而扩大权限或自动重试。
