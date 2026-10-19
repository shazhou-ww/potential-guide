# Implementation

## Steps

### I-S01: 修复完整检查与异步回归

复现并修复 supervisor 子测试生命周期、setup prompt 超时覆盖及 CLI supervisor
收敛时序；优先修正根因，不靠跳过、缓存旧成功或无依据扩大时限获得绿灯。
将误嵌套的授权回归恢复为独立顶层测试；对真实 prompt 和最终观察使用有上限的就绪握手，
计时上限仅作失败 watchdog，不作为“已执行/已收敛”的成功证据。
交付 CI 暴露的 retry 配额回归也属于本门禁：定位 overall time quota includes
probe retries and retry delays 在两种 Node 环境中预期 503、实际 408 的原因，
保留整体 quota、重试延迟和最后故障的业务断言，不凭任意扩大时限掩盖竞态。

最终独立消费者还暴露 Windows 冷启动下真实 setup sanity 超过既有 24 秒硬上限。
保持默认行为和有界执行，不为测试无条件放宽生产期限；为明确选择较长本地检查的调用方，
提供与实际外层 process probe 期限一致、留有清理余量的显式预算支持。
优先复用已有 probe 配置和运行上下文，不引入独立、相互矛盾的时间配置；
默认 30 秒 process probe 下仍拒绝超过 24 秒的 setup subject。
只有外层已明确配置足够期限时，本地 Git Pilot 才能接受较长 subject，
无效、超预算及超时输入必须明确失败，实际取消和进程树清理仍需覆盖。
不扩展 SSH 支持范围，不替换为 direct helper、预热或重试，也不削弱随机 nonce、
固定 revision、独立最终 probe 和真实 terminal 断言。

### I-S02: 更新候选版本与变更清单

对照已发布 RC 的 producer commit，按各包实际公开 API 变更选择新的 0.x RC，
保持 workspace 依赖与 lockfile 一致，记录依赖顺序和未来稳定版本映射。
逐包分类和映射见 [Release-candidates.md](Release-candidates.md)；未改变的上游保留原版本，
仅为已改变包准备新的 RC，不执行真实发布。

### I-S03: 补齐稳定版消费验证

复用发布版本解析规则，让独立 npm 验证支持稳定和 RC，覆盖仅安装 pguide
入口包并解析其传递依赖的路径，明确精确版本与 latest 验证语义并补测试和文档。
本地入口 tarball 通过隔离消费者的内部 tarball overrides 解析未发布依赖；
真实 `--published` 和 `--latest` 模式不使用 overrides，也不额外安装七个内部包。
沿真实父包解析依赖并核对所有版本、pack 后范围、库导入和命令。

## Acceptance criteria

### I-AC01: 质量门禁可信

主会话独立运行 pnpm check，并对已知失败场景定向复测；Node 22.13.0 与
24.11.1 的相关回归均通过，授权测试不再被父测试取消。
显式长预算的安装产物 Git Pilot 实际达到 terminal；同时证明默认预算保持兼容、
不足的外层期限被拒绝，实际超时或取消不会泄漏 Agent、后代进程或操作目录。

### I-AC02: 版本与代码一致

逐包候选清单能说明相对旧 RC 的变更、版本和依赖关系；主会话核验版本、
lockfile 与打包产物，不覆盖任何已发布版本。

### I-AC03: 稳定版验证可执行

测试证明合法 0.x 稳定版和 RC 被接受、非法版本被拒绝，并验证入口包单独安装
及其传递依赖的检查逻辑；文档不把本地产物或精确版本安装当成 latest 验收。

实现者反馈见 [Implementation-evidence.md](Implementation-evidence.md)。该反馈不代替主会话独立检查、
同步、阶段提交或验收；真实 registry 消费和跨平台运行也不由本地反馈推断。
