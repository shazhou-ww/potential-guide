# 产品修改建议

把本次 33 项问题归并为 11 项可独立讨论的产品修改建议。读本页即可选择方向，无需逐条阅读事故记录；每篇建议包含修改内容、责任边界、取舍和验收场景。原始[问题清单](./Acceptance-issues.md)保留为证据，不再作为主要阅读入口。

**这些是建议，不是已确认的缺陷清单，也不是已经批准的实施计划。** 对已存在的功能，建议补齐默认流程和可发现性，而不是再造一套。操作失误同样进入产品改进范围；系统性根因未知时，先提出可验证的诊断或防错能力，不凭一次失败改业务语义。

## 项目归属与执行入口

已按实际修改范围整理为[归属表与子 IDEA](./Ownership-and-child-ideas.md)：7 项完全属于本仓库，R-11 拆出本地报告适配后共创建 8 个子 IDEA，方案全文已复制。外部部分已创建 Pinboard 的 CLI 认证诊断、CAR 严格导入和 Silvermoon 证据呈现共三条 issue；MCP Portal 与 Agent 宿主两项因归属未确认，按用户要求跳过。链接与提交范围见归属表。子 IDEA 独立维护范围和门禁，创建 issue 不代表统一批准或自动启动。

## 建议总览

“先做”表示优先讨论的交付基础能力，不表示已获实施授权。

| 建议 | 对应产品 / 责任方 | 希望发生的变化 | 建议次序 | 主要覆盖问题 |
| --- | --- | --- | --- | --- |
| [R-01：绑定制品身份与来源](./recommendations/R-01-artifact-identity.md) | Task Bundle 工具、仓库构建链路 | 不再人工拼 CID/哈希；旧缓存、旧副本在发布前被拒绝 | 先做 | A-01、A-02、A-03、A-04、A-05 |
| [R-02：提供统一发布就绪检查](./recommendations/R-02-release-readiness.md) | 仓库发布工具、GitHub Actions | 新包缺接线、依赖未发布、准确 CI 未通过时，提前给出完整原因 | 随后 | A-06、A-07、A-10 |
| [R-03：交付可安装的套件版本清单](./recommendations/R-03-suite-installation.md) | Task Engine / pguide 发行链路 | 用户安装一个经过验证的组合，而不是猜每个包的 latest | 随后 | A-08、A-09、A-11 |
| [R-04：按通道诊断认证与可用能力](./recommendations/R-04-auth-capabilities.md) | Pinboard CLI、MCP Portal / 客户端 | 清楚区分命令存在、连接就绪、授权有效及支持的操作 | 随后，可独立推进 | A-12、A-13、A-14、A-15 |
| [R-05：导入前强制核对期望根](./recommendations/R-05-pinboard-import.md) | Pinboard 服务、CLI、MCP | 错根 CAR 不产生正式 pin；回执字段不再混淆字节口径 | 先做 | A-16、A-17、A-19 |
| [R-06：让本地文件直接进入授权上传通道](./recommendations/R-06-local-file-upload.md) | Agent 宿主 / MCP 适配层，Pinboard 配合 | 二进制不经过模型手工转抄；保留原有授权隔离 | 先做 | A-18 |
| [R-07：交付受测试的消费验收工具](./recommendations/R-07-consumer-verification.md) | 仓库消费验证工具、pguide 分发入口 | 不再临时拼跨平台脚本；失败也能保存阶段结果并清理资源 | 先做 | A-20、A-21、A-22、A-23、A-24、A-25 |
| [R-08：把 Check 消费契约做成可执行范例](./recommendations/R-08-check-contracts.md) | Check SDK、check-environment | 请求、问题码和取消解读不再靠猜，错误定位到字段和阶段 | 随后 | A-26、A-27 |
| [R-09：让启动与物理回收失败可诊断](./recommendations/R-09-engine-lifecycle.md) | Task Engine、Probe、测试链路 | 把偶发超时变成有因果证据的失败，再按证据修复 | 诊断先做，行为修复后定 | A-28、A-29、A-30 |
| [R-10：提供受验证的按 CID 读取 Reference 入口](./recommendations/R-10-reference-reading.md) | Task Engine 内容读取、Check 消费工具 | raw-only Gateway 也能读取并校验 Reference，不猜 HTTP 路由 | 先做，当前直接阻塞 | A-31、A-32 |
| [R-11：按验收范围展示当前证据](./recommendations/R-11-evidence-scope.md) | Silvermoon、仓库交付报告适配 | 一眼区分已安装、已上传、已执行、未验证及过期证据 | 随后 | A-33 |

## 为什么这样拆

- **R-01 与 R-05 分开**：前者证明准备上传的是哪个制品，后者保证服务没有接受错误制品；客户端预检不能替代服务端约束。
- **R-04 与 R-06 分开**：授权诊断解决“走哪条通道”，本地文件桥接解决“字节怎样进入通道”。不能用共享或导出凭据来替代任何一项。
- **R-03 与 R-07 分开**：安装清单决定装什么，验收工具证明装完能做什么；一次安装退出 0 不等于消费成功。
- **R-08 与 R-09 分开**：Check 请求与结果的业务契约不能侵入通用 Engine 生命周期；目前不建议统一重写取消终态。
- **R-10 不以扩建 Pinboard HTTP Gateway 为前提**：已有 raw 块获取足以支撑客户端 UnixFS 读取，先复用现有标准组件闭合消费路径。若之后确有浏览器直链需求，再单独讨论 HTTP 路径服务。

## 推荐的第一批边界

优先讨论 R-01、R-05、R-06、R-07、R-10：把“选对制品 → 无损上传 → 消费与读取 → 留下可靠证据”连通。它们不要求同时完成全部 11 项：

1. R-01、R-05、R-06 分别由构建侧、Pinboard 侧、Agent 宿主侧负责，可独立验证；联合演示时使用同一个已验证 CAR。
2. R-07 可以先收编当前消费验证流程；Reference 阶段明确依赖 R-10 的受支持读取入口，不以直接 HTTP 路径代替。
3. R-09 先增加可重现诊断，不把“连续重试至通过”作为交付策略；R-11 不替代任何实际运行证明或人工验收。

原始 33 项均在上表有一个主要归属；相关建议可在正文交叉引用。历史失误、已恢复状态和未知根因不会因改写成建议而被删除。
