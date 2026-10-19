# Agent 开发机持续健康 Pilot

这是独立的 repository-owned Pilot，不新增 CLI 子命令，不依赖模型调用，也不取代
pguide setup／self-check 的安装和 Agent 协议验证。

## 范围与授权

本次交付以本机 Linux Docker 容器的真实场景验证为准。Linux／WSL 的环境类别保留，
但本次 Docker 结果不证明原生 Linux、WSL 或其宿主健康。系统包检查首版针对
Debian／Ubuntu 的 dpkg／apt 能力；其他发行版不能被静默判定通过。

目标账号是专用非 root 用户，具有约定范围内的非交互 sudo 管理能力。接管授权是持续
契约：Agent 在该范围内维护软件、目录与系统，无需逐项重新批准；这不扩大到容器宿主，
也不取消未提交成果保护、变更可恢复性及操作记录要求。

check 只观测及执行独占临时目录内的最小能力验证，不安装、修复、清理用户数据或
终止登记的开发任务。临时读写探测和构建产物由 check 自行清理。

## 五层状态

| 当前层级 | 晋级条件 |
| --- | --- |
| `initial` | 执行身份、环境类别、HOME／目录归属及无人值守 sudo 符合约定 |
| `managed` | 容量、inode、基础读写、包管理器和选定网络要求正常 |
| `system-ready` | Git 和所选技术栈版本满足要求，最小编译／运行成功 |
| `development-ready` | 目录布局、任务登记及已知残留符合保留规则 |
| `orderly` | 历史证据足够且新鲜，增长风险和本地包更新状态符合策略 |
| `terminal` | 本次观测中所有条件满足，不是永久健康保证 |

每次完整 Pilot 从首层重新观测，发生退化即报告对应层级与具体问题。调用故障返回
非 200 envelope，不伪装成 gap 或通过；不适用项在诊断中说明原因。

## Subject 与入口

以下路径属于目标容器，不属于控制机。`target.type: docker` 通过已存在的本地 Docker
引擎执行；目标必须具备 Node.js。它只发送检查源码和非秘密 subject，不挂载宿主目录，
也不复制宿主 HOME 或凭据。容器名与执行用户分别传参，连接失败绝不回退到本机。

```json
{
  "target": {"type": "docker", "container": "my-agent-dev"},
  "environment": "container",
  "user": "agent",
  "home": "/home/agent",
  "workspace": "/home/agent/work",
  "scratchDirectory": "/home/agent/tmp",
  "cacheDirectory": "/home/agent/cache",
  "logDirectory": "/home/agent/logs",
  "tasksDirectory": "/home/agent/tasks",
  "stacks": ["typescript", "python", "cpp", "rust"],
  "network": {"dns": ["localhost"], "urls": []}
}
```

直接检查示例（Windows 控制机）：

```powershell
node objectives\development-machine-health\health-check.mjs identity --subject-file D:\health\subject.json
node objectives\development-machine-health\health-check.mjs sample --subject-file D:\health\subject.json
```

`sample` 只返回实际资源快照，不写历史。由调用方保存并将同一目标的多个快照放入
subject 的 `history`；没有足够样本时不能到达最终健康状态。样本覆盖短时变化，
不能冒充长期可靠性证明。需要定期调度时由外部调度方负责。

提交 Pilot 后运行完整观测：

```powershell
node packages\pguide\dist\bin\probe.js --pilot objectives\development-machine-health\pilot.yaml --subject-file D:\health\subject.json --format json
```

该入口要求干净、已提交的 Git 版本。直接 helper 可用于未提交开发，但不构成绑定代码版本
的完整 Pilot 收据。

## 默认要求与可覆盖策略

`minimumVersions` 可按工具名覆盖最低版本，值为数字版本字符串：

| 工具 | 默认最低版本 |
| --- | --- |
| Git | 2.30 |
| Node.js／npm／TypeScript (`tsc`) | 22.13／10／5 |
| Python (`python3`) | 3.10 |
| C++ (`c++`)／CMake／Ninja | 10／3.20／1.10 |
| rustup／rustc／Cargo | 1.25／1.75／1.75 |

只检查所选栈；Git 是公共基线。TypeScript 使用现有编译器而非自动下载，Python 创建 venv，
C++ 使用 CMake／Ninja，Rust 离线构建无外部依赖的 crate。

`policy` 可部分覆盖以下字段，未指定的使用默认值：

| 字段 | 默认值及含义 |
| --- | --- |
| `minFreeBytes` | 1,073,741,824，workspace 文件系统至少 1 GiB 可用 |
| `minFreeInodes` | 1,024，workspace 文件系统可用 inode 下限 |
| `retentionSeconds` | 86,400，已完成任务临时产物保留期限 |
| `historyMinSamples`／`historyMinSpanMs` | 3 个样本，至少跨越 1,000 ms |
| `historyMaxAgeMs` | 最新样本不超过 300,000 ms |
| `maxCacheGrowthBytesPerSecond` | 1,048,576 bytes/s |
| `maxLogGrowthBytesPerSecond` | 65,536 bytes/s |
| `maxPackageIndexAgeSeconds` | 604,800，包索引新鲜度上限 7 天 |

容量等于下限、增长等于上限时通过。历史必须来自相同 hostname／user／home，时间递增、
非未来值且指标非负；样本不足和身份错误均不能证明持续健康。
包更新模拟只依据本地 apt 索引，不代表已实时查询安全公告。有 root 所有的有效
`/var/lib/apt/periodic/update-success-stamp` 时采用其时间，否则保守采用最旧 Packages
文件时间；Packages 必须存在。夹具在成功更新、安装后记录该成功时间。

## 任务登记与保护规则

仅检查 `tasksDirectory` 直属的、由目标用户所有的普通 `.json` 文件。示例：

```json
{
  "id": "build-example",
  "state": "finished",
  "startedAt": 1790000000000,
  "finishedAt": 1790000010000,
  "temporaryDirectory": "/home/agent/tmp/build-example"
}
```

时间字段为 Unix 毫秒。活动记录使用 `state: active` 和实际 `pid`，可选 `deadlineAt`；
完成记录要求 `finishedAt`。临时路径只能是 scratch 的直属目录。检查会报告孤儿任务、
显式期限超时、完成后仍运行的进程和超过保留期的已知残留，不会自行删除或终止。
不将未知文件、长时间但无超期约定的活动任务、未提交仓库视为垃圾。

## 本机 Docker 验收

前置：可访问的 Linux Docker 引擎、Node.js ≥22.13、pnpm ≥11.22，以及宿主构建时可获取
公开镜像、Debian 包和固定版本 TypeScript npm 包。缺少 Docker 或构建失败会明确失败，
不会跳过后声称验收成功。无需提供模型或云账户凭据。

```powershell
pnpm health:verify --report D:\health\docker-report.json
```

验收脚本使用当前提交的 Git Pilot 和真实 `pguide probe`，不是替换 check 的假数据。
它准备包含四种技术栈的镜像，为每个场景创建独立容器，断言问题层级、具体问题 ID，
保留完整观测、镜像 ID、依赖完整性信息和 Docker／代码版本。

镜像中的 TypeScript 5.9.3 由宿主 `npm pack` 下载，再在容器内离线安装，避免依赖
容器内 registry 认证／代理配置；不禁用 TLS 验证或转发宿主 npm 凭据。
镜像准备不是健康 check 的一部分。

运行时容器无外网、无宿主目录挂载、无 Docker socket、无特权模式，限制 CPU、内存
和进程数。空间／inode 故障在 2 MiB、64 inode 的容器 tmpfs 内制造，不填满宿主磁盘。
结束后删除本次创建的容器、唯一镜像标签及临时构建目录，保留明确指定的报告。

覆盖健康、权限、容量、网络、工具缺失／版本／真实构建失败、任务残留、历史不足／错误／
过期、实际缓存与日志增长、恢复和再次退化；同时保留正常后台任务、未知文件和未提交
成果作为保护样本。准确场景列表与结果以验收报告为准，不把尚未运行的场景当作证据。
