# Deployment

本次交付独立本机自查 Objective。实现 `328ef4cd0c4740ff2001b677984060d4e23ab306` 已获用户接受；交付固定到该决定所在 primary commit `d037049c62740907b7485077da006cae73576845`，不使用移动分支或未提交源码。

交付目标沿用用户要求建立并独立授权的 Linux 容器 `pguide-agent-keychain-1ce0ed16`，用户 `node`、HOME `/work/home`，使用已有打包安装的 `pguide 0.4.0-rc.0` 和已验证的官方 Copilot `1.0.98` / `gpt-5-mini`。此验收不把容器结果代称 Windows 宿主、其他用户或远端 SSH 已就绪；不发布 npm，不迁移或导出认证容器、token 或 keyring。

交付源为 `git+https://github.com/shazhou-ww/potential-guide.git#packages/pguide-self-check-pilot/pilot.yaml`，revision 为上述完整 commit。检查在本契约同步到 primary 后执行；Git 访问或认证失败明确记录为交付阻塞，不静默换成本地 fixture 或旧快照。此前结果见 [历史交付证据](./Verification.md)，不沿用为本次新版本交付成功。

## Steps

### D-S01: 同步并验证子目录交付

确认已验收版本可从刷新后的 origin/main 到达，由目标容器通过上述固定 Git 子目录 URI 读取交付版本，核对完整 revision、Pilot 路由及引用，不导入未提交文件或依赖宿主源码挂载。

### D-S02: 验证目标用户的本机自查

在目标容器内确认现有 keychain 已解锁和 Agent/模型配置未发生变化，复用已有真实 baseline 作为前置证据，不仅凭模型列表放行。用该设备已安装的 pguide 对上述交付 URI 执行一次完整自查，显式 subject 60000 ms / 外层 probe 90000 ms、重试为零。

仅预授权本次隔离 marker 的绝对路径写入，保留 shell/URL 工具拒绝和额外临时目录限制；受控本地启动器只接入容器已有的私有 Secret Service，不复制认证或扩大全局 probe 环境白名单。记录原始 Envelope、配置上下文、安全方法审计及清理结果，不重复模型请求来确认既有结果。认证、网络、权限或额度阻塞时停止并记录下一动作。

## Acceptance criteria

### D-AC01: Git 子目录可用

固定交付 URI 的原始 probe versions 精确匹配 `d037049c62740907b7485077da006cae73576845`，引用与执行路由正确，且提交可从刷新后的 primary 到达。只读取测试替身或本地导入快照不满足此项。

### D-AC02: 真实交付自查通过

目标容器已安装的 pguide 对上述交付版本返回 terminal、空 problems 和精确版本；只有一个真实 prompt、正常 end_turn、随机文件独立内容核验成功，且独占 scratch 清理完成、无关文件保留。仅 Envelope 200、模型目录、登录成功或实现阶段旧结果均不能替代。

交付证据必须明确容器、用户、安装来源、显式期限和适用限制。后续 A 对 B 的整备应调用 B 自己安装的 pguide 和同一自查，以 B 的结果验收；本轮不宣称已完成远端整备接入，也不证明默认预算或 Windows 宿主就绪。
