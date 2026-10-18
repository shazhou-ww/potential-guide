# 实现验收证据

## 交付接口与职责

Objective 位于 `objectives/pguide-setup/pilot.yaml`，实际等级为 initial、installed、configured，最终隐式等级 terminal。各级分别验证安装、配置及 ACP 接入、真实 sanity。运行脚本仅依赖 Node 内置模块，Git 子目录快照无需安装项目依赖。

外部 Agent 可直接运行 `node objectives/pguide-setup/setup-check.mjs installation|configuration|sanity --subject-file <绝对路径>`。subject 指定 workingDirectory、configPath、scratchDirectory 和 pguide 的 command/args；可选 desiredVersion、agent、userHome、allowSanity 和 timeoutMs。版本比较为准确的 CLI version，不冒充 Git commit 一致性。

bootstrap 指引要求先识别自身是否存在独立 ACP 入口，优先复用已有认证；无法导出 IDE 会话时不得虚构入口。没有 allowSanity 明确授权时不发起 Agent prompt。测试及本会话均未进行全局安装、修改真实用户配置或调用真实付费模型。

## I-AC01: 定义与文档

严格加载测试验证 manifest、等级和全部声明问题的 scoped Wiki；README 与 bootstrap 文档提供安装来源、当前未发布源码的使用方法、配置、subject 和自举顺序。

根 lint 已包含 objectives；pguide 测试任务的 Turborepo inputs 显式包含仓库 objectives，dry-run 确認新增 Objective 与 sanity fixture 均参与缓存指纹，避免仅改 Objective 后误用旧测试缓存。

## I-AC02: 行为证明

15 项新增自动测试全部通过，覆盖：

- 缺失或不可用安装、准确版本不符、缺失或错误配置、缺少 Agent、ACP 协议或接入失败。
- 无授权时连 pguide/ACP 子进程都不启动。
- 空报完成和写错内容的 Agent 都不能通过；实际修复写入随机 nonce 后才通过独立验证。
- 直接 bootstrap 可使用显式引用的环境认证；Git probe 的既有环境隔离不被弱化，缺少认证环境变量会报告 environment-unavailable；已有文件认证可通过 Git probe。
- 超时终止父子进程树，包含真实 ACP prompt 中的超时；PID 不再存在，隔离 config、state 和 scratch 均清理。

sanity 使用独立临时已提交 Git fixture，先验证缺陷，再实际调用 pguide regulate，核对随机内容及最终观测，不信任 Agent 的完成摘要。默认总时限 20 秒，可选 100 至 24000 毫秒，内层 Agent/run 额度不超过 12 秒。

## I-AC03: 主会话集成验证

主会话独立执行 pnpm check 成功；新增 setup 测试纳入默认 pguide suite。总计 181 项测试，180 项通过，1 项为已有 Windows 平台大小写敏感测试跳过，没有失败。

主会话扩展 deployment:verify：将实际 setup 子目录复制进独立 Git 仓库并提交，通过独立安装的 pguide 使用精确 commit URI 加载该目录，调用本地 ACP 测试替身写入随机 nonce，确认 observation.current 为该 setup Objective 的 terminal、problems 为空且版本匹配。八个包安装验证与此路径均通过。

## 验收判断与限制

子会话负责 Objective 与测试实现，主会话负责验收、根检查和独立安装集成。I-AC01、I-AC02、I-AC03 满足，可提交实现门禁。

测试替身证明协议与执行链，不代表当前设备已配置真实 Agent。没有改变 probe 的凭据继承规则；环境变量认证受限时应使用直接 bootstrap，并由后续显式授权决定认证方案。临时目录隔离不是对恶意 Agent 的安全沙箱。Windows 已实测，POSIX 清理路径未在本会话实测。
