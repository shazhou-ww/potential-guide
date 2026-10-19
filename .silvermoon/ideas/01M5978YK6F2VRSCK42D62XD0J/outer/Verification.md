# 本机 Docker 交付验收

## 验收对象与环境

依据 [Deployment.md](./Deployment.md) 的 33 场景标准，在实施门禁批准后独立重跑：

```powershell
node scripts\verify-development-health.mjs --report .cache\development-health-docker-deployment.json
```

- 代码版本：`b58fd18d00b33c2f960042696335843924b9b496`，已同步到 primary。
- 控制机：本机 Windows；目标为 Docker Desktop 的 Linux 容器，不是原生 Windows。
- Docker Server：29.8.2，context 为 `desktop-linux`。
- 本机连接：`npipe:////./pipe/dockerDesktopLinuxEngine`，没有 `DOCKER_HOST` 覆盖。
- 开始：2026-10-19T06:33:50.942Z；结束：2026-10-19T06:42:40.852Z。
- 镜像：`sha256:1adb3f0a94048b812f18cf233b6f0a6f26220bb54be75e235b2e923f4a07e251`。

## 实际结果

[原始 Docker 收据](./Docker-verification.json)记录 **33/33 通过**，
`passed: true`、`cleaned: true`，没有跳过场景。主 Agent 逐项复核了场景数量、通过状态、
实际问题参数、源版本和清理结果。

| 范围 | 已观察结果 |
| --- | --- |
| 正常能力 | 指定非 root 账号具备 sudo；四种技术栈实际完成最小构建／运行；完整 Pilot 到达 terminal |
| 身份与权限 | root、错误环境类别、目录归属错误及 sudo 缺失均定位到系统管理基线；受控修复后恢复 |
| 系统条件 | 在独立 2 MiB／64 inode tmpfs 内制造的容量及 inode 故障准确检出；HTTP、包数据库损坏、依赖不满足分别检出 |
| 工具链 | 版本不满足、四栈各自缺工具、编译器存在但构建失败均检出，不以版本命令成功代替开发能力 |
| 工作秩序 | 目录重叠、非法登记、孤儿、超期、已完成残留及仍运行的已完成任务均检出；正常活动任务、未知文件和未提交成果保持完好 |
| 持续证据 | 缺少／外来／过期历史、实际缓存及日志增长、过期包索引、待升级软件包分别检出；增长停止并重新采样后恢复 |
| 调用与退化 | 非法输入明确拒绝，Docker 目标不存在时不回退到宿主；健康后再次引入故障会降级 |

所有场景运行真实 Git 绑定 Pilot 和独立进程 checks；健康场景另外执行真实 CLI，
核对 API／CLI 的层级及版本一致。复用的是不可变代码快照，不是之前的健康结论。
每个领域 gap 断言层级、问题 ID 和非空参数；调用失败另行核对非 200 envelope、
空 payload 及明确消息，不伪造为健康状态。目录、容量、inode、工具、增长等场景还核对
具体目标、要求值和实际值。修复是测试驱动对已知夹具的受控恢复，不宣称已验证模型的
自主维修决策。

运行时容器没有宿主目录、Docker socket 或特权模式，禁用外网并设置 CPU／内存／
进程数限制。容量故障没有填满宿主磁盘。脚本已删除本次容器、唯一镜像标签及临时构建
目录；额外执行 `docker ps --filter name=pguide-health-` 未发现遗留测试容器。

## 仓库检查与明确例外

本次健康回归 **15/15 通过**；格式、lint、类型检查和全部 workspace 构建／打包验证通过。

完整 `pnpm check` 的最终重跑没有通过：旧的 setup／self-check 测试共 11 项失败，
不能把全库状态报告为绿色。[结构化记录](./Repository-check.json)列出准确测试名。
其中新增观察到的 5 项启动／超时失败单独重跑均通过（5/5）；另一个持续 sanity 协议
错误已在[基线源码复现](./inner/Baseline-check.json)。相关旧测试、setup／self-check、
CLI 和 Pilot 源码相对 `d35db75` 没有变化，但没有独立重建整套基线，也未宣称定位了
全部 11 项失败的原因。本次不修改这些无关实现或降低它们的测试断言。

按照已同步的 I-AC03 明确例外，主 Agent 接受本次健康 Pilot 的独立验证，不豁免本次
Docker 交付：其 33 个场景必须全部真实通过。主 Agent 根据用户明确的门禁委托，确认
D-AC01 和 D-AC02 满足；准确 world revision 的批准以同步的事件日志为准。

## 交付范围

这是本机 Docker 的实际交付，不代表原生 Linux／WSL 实机、宿主机或长期运行已经验证。
历史指标目前是容量、inode、缓存和日志，不含 CPU／内存持续异常检测；测试中的资源
限制只是隔离措施。包更新依据本地 apt 索引及其新鲜度，不等于实时安全公告证明。

用户可按[运行说明](../../../../objectives/development-machine-health/README.md)执行
`pnpm health:verify`，重新建立一次隔离、可重复的验收。
