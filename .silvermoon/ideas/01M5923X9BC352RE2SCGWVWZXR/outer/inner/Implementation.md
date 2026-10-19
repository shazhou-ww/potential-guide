# Implementation

## Steps

### I-S01: 修复完整检查与异步回归

复现并修复 supervisor 子测试生命周期、setup prompt 超时覆盖及 CLI supervisor
收敛时序；优先修正根因，不靠跳过、缓存旧成功或无依据扩大时限获得绿灯。
将误嵌套的授权回归恢复为独立顶层测试；对真实 prompt 和最终观察使用有上限的就绪握手，
计时上限仅作失败 watchdog，不作为“已执行/已收敛”的成功证据。

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

### I-AC02: 版本与代码一致

逐包候选清单能说明相对旧 RC 的变更、版本和依赖关系；主会话核验版本、
lockfile 与打包产物，不覆盖任何已发布版本。

### I-AC03: 稳定版验证可执行

测试证明合法 0.x 稳定版和 RC 被接受、非法版本被拒绝，并验证入口包单独安装
及其传递依赖的检查逻辑；文档不把本地产物或精确版本安装当成 latest 验收。

实现者反馈见 [Implementation-evidence.md](Implementation-evidence.md)。该反馈不代替主会话独立检查、
同步、阶段提交或验收；真实 registry 消费和跨平台运行也不由本地反馈推断。
