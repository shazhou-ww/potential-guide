# Pilot 目录身份迁移影响与验证矩阵

本文服务于 [Idea](./Idea.md) 和 [上下文设计](./Context-objectives.md)。源码位置来自本轮检查，是实施入口而非穷尽文件清单；实施时须继续追踪各入口的调用者、协议消费方和测试，不能只改列出的文件。本轮不修改实现。

## 核心身份与版本契约

- Objective ID 从 manifest 文件 URI 改为规范化的 Pilot 目录 URI，pilot.yaml 是目录内部入口，不再充当业务身份。Subject 的 JSONata 绑定不改变这一规则。
- 同 repo 的不同目录是不同 ID；同一目录引用的可接受路径写法必须得到唯一结果。目录移动改变 ID，即使 tree 内容相同也不能仅凭哈希合并目标。
- 目录末尾斜杠、仓库根目录、URL 编码、Windows 本地路径和相对来源须有明确的规范化规则，拒绝歧义和目录逃逸。具体根目录 URI 写法在实施前确定并验证，不默用当前强制非空 manifest fragment 的规则。
- 业务身份与资源地址分开：manifest、References、检查脚本各有实际资源 URI。不能让资源规范化函数无区别地将所有文件地址裁剪为目录 ID。
- Pilot 内容版本是 Git tree OID；来源 commit 负责取回不可变快照。二者都可能是相同长度的十六进制字符串，长度正则不能证明对象种类。
- 观察版本键使用目录 ID，值和来源证据必须明确区分内容 tree 与取回 commit；具体结构在实施阶段收敛，并贯通跨进程协议。不能把 tree 塞进现有 commit 字段后宣称完成。
- 一个目录 tree 只覆盖其受跟踪内容。外部资源、其他 Pilot、子模块和链接需要独立证据或明确拒绝；纯内存/HTTP/file 测试来源不得被伪报为 Git tree，需保留明确来源类型和验证边界。

## 源码影响矩阵

| 范围 | 已观察的耦合入口 | 本次必须处理的结果 |
| --- | --- | --- |
| 目录 ID 与资源定位 | objective-pilot 的 resources.ts / canonicalManifestUri；pilot.ts / loadPilotSpec | 分开 Objective 目录身份与 manifest/resource URI；重新定义入口读取和相对 References、脚本路径，更新公共导出及调用方，不靠尾部字符串替换 |
| 领域协议 | objective-pilot 的 types.ts、pilot.ts、validation.ts、index.ts | PilotSpec、LevelRef、ProblemRef、current、依赖问题、versions、引用页与错误消息均使用一致目录 ID；严格验证旧文件 ID 边界 |
| Git 快照能力 | git-source 的 GitSnapshot、GitSourceSpec、刷新与读取 API | 在精确快照上获取并验证目录 tree，不将 tree 当 commit；复用 ref 观察与取消/清理设施，不引入脱离 scope 的刷新进程 |
| CLI 来源绑定 | pguide 的 pilot-source.ts / bindPilot、resourcePath、sourceFor、ResourceResolver、运行脚本映射 | 当前把 fragment 当 manifest，版本直接取 snapshot.commit；执行路径还依赖 manifest 所在目录，必须整体接线。目录内容版本与取回定位分离 |
| 多来源及缓存 | pilot-source.ts 的 sources、requestedVersions、sourceSignals、materialize；git-source 缓存 | 当前按 repository 复用 snapshot 且把 required version 与 commit 比较；显式区分来源选择、快照及目录版本，覆盖同 repo 多目录/多版本需求，不能错取缓存 |
| 依赖证据与进程边界 | objective-pilot 的 dependency.ts、dependency-loader.ts、dependency-preload.ts、probes.ts、evidence.ts | 观察栈、版本合并、绑定表、recordObservation、跨进程证据和冲突检测使用目录 ID 与完整版本关联；未知对象种类/缺失证据明确失败 |
| Regulator | objective-regulator 的 index.ts，pguide 的 regulation-worker.ts | 观察归属、目标匹配、Agent 输入、停止与依赖交接一致，不能混用文件 ID 与目录 ID |
| Supervisor | objective-portfolio-supervisor 的 planner.ts、decisions.ts、types.ts；pguide 的 commands/supervisor.ts | 实例去重、派生 goal、等待图、版本解析、循环诊断、逐消费者阈值、更新替换和迟到结果过滤全部按新身份；同 tree 的不同目录不得合并 |
| 持久化与继续运行 | pguide 的 commands/regulator.ts、commands/pilot.ts 及运行状态、报告设施 | 当前 pilotUri/pilotCommit 与 spec.version 直接比较；记录目录 ID、来源 commit 和 tree 版本，恢复可取回并复核快照，明确旧记录 schema 的迁移或拒绝 |
| CLI 发现与管理 | pguide-config 的注册操作；pguide 的命令帮助、目录清单加载、probe/regulate/supervise/continue/validate/scaffold 和入口元数据 | 用户级旧来源别名、目录声明、显式 Pilot 来源都经过一致身份边界；展示原始来源和解析身份，发现不执行，治理参数不进入声明 |
| 仓库自有消费方 | 四个 objective-* Pilot package、其文档和 fixtures；scripts 的 verify-monorepo-pilot、verify-development-health、verify-deployment、self-check-docker 等验证脚本 | 更新 URI、版本断言、生成说明与相关生成物，真实消费仓库内目录引用，不留下只能靠旧文件 ID 通过的自测 |
| 文档和交付协议 | 各公开包 README、docs/functional-migration.md、docs/pilot-packages.md、相关 schema/示例/测试 | 解释破坏性身份和内容版本变化；直接相关公共类型及消费 API 均有迁移指引，历史 Idea/报告不改写为新证据，实际发布仍独立授权 |

## 迁移边界

必须在实施中明确旧 manifest 路径输入、旧文件 URI、旧 registry、旧 Observation/报告和旧恢复记录各自的处理方式。用户输入若提供便捷转换，只能在入口规范化到唯一目录 ID；核心观察和依赖图不得长期保留双轨身份。不能简单删去任意文件名并把非 pilot.yaml 文件错误识别为同一目标。

旧 commit 版本与新 tree 版本不能仅按字符串长度互认。历史证据可以保留只读展示，但不经验证不能用于新依赖放行或继续治理。若旧记录缺少恢复所需信息，应明确拒绝并给出重新绑定指导，不猜测最新 HEAD、不静默重写历史。需要升级持久化或输出协议版本时，只升级实际改变的协议，并验证可诊断错误。

本次包含仓库自有活跃消费方的接线与迁移，不把当前仓库能否使用新身份留作后续事项；其他项目真实迁移需单独授权。前一 dependency Idea 的历史契约和已记录证据不被回写，只在本 Idea 说明新增版本语义。

## 必需验证矩阵

| 场景 | 证明的结果 |
| --- | --- |
| 同目录不同可接受引用、尾斜杠、编码、根目录、Windows 路径 | ID 唯一、资源解析正确，危险路径明确拒绝 |
| 仅改 manifest / 检查脚本 / References / 目录内资源 | 每种变更都更新 tree 内容版本，观察取自同一快照 |
| 改仓库无关文件、目录移动、两个内容相同目录 | 无关提交不改变目录版本；目录移动改变 ID；同 tree 不合并不同目标 |
| 同 repo 多 Pilot、跨 repo 依赖、不同来源版本要求 | 精确取回与版本关联正确，缓存不串用，冲突显式暴露 |
| 本进程和 process probe 的成功/未达标/失败 | 两类正常观察都贡献版本，tree 与 commit 正确回传，调用失败不伪装依赖问题 |
| 来源在运行中更新、依赖目标更新、旧结果迟到 | 当前观察保持一致；新绑定重新观察和计算等待，旧结果不能放行新需求 |
| 取消、资源释放、来源更新失败 | 无悬挂刷新或遗留执行，更新失败可见，不声称已使用最新版本 |
| 重启、continue、历史状态/报告 | 可凭 commit 取回并核对 tree；旧身份/版本按迁移策略处理，不误读为新证据 |
| 用户级与目录级声明、Unit/参数化输入 | 存储作用域不决定输入类型，schema 校验及 subject 投影一致，同名明确消歧 |
| 仓库自有 Pilot 和验证脚本 | 使用目录 ID 跑通直接 probe、依赖交接及恢复，相关测试与 pnpm check 通过 |

实施完成时在 Inner World 证据中逐项给出对应改动与验证结果；外部消费者和重启证据按 Deployment 契约记录。未覆盖项必须明确阻塞或收敛边界，不得以修改了 URI 示例代替身份协议交付。
