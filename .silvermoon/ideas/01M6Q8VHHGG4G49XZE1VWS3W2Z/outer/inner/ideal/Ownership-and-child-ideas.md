# 建议归属与子 IDEA

## 分类结论

当前项目是 **shazhou-ww/potential-guide**。11 项建议中，**7 项完全属于本仓库、3 项主要属于其他项目、1 项跨项目**；跨项目 R-11 拆出本地报告适配后，共创建 **8 个本仓库子 IDEA**。

本次按用户要求创建和复制方案，不实施产品改动，不提交或接受子 IDEA，也没有创建任何外部 GitHub issue。父子关系以总览和子 IDEA 的双向链接表达：当前 Silvermoon CLI 没有 parent 创建选项，未擅自增加 schema 字段、父子事件或嵌套目录。各子 IDEA 是独立的平铺构想，父级不会替它们自动审批。

## 当前项目：已创建的子 IDEA

| 建议 | 归属 | 本仓库实际修改范围 | 子 IDEA |
| --- | --- | --- | --- |
| R-01 | 当前项目 | Task Bundle 离线身份记录、构建/发布来源和缓存验证；外部服务端校验仍归 R-05。 | [绑定 Task 制品身份与交付来源](../../../../01M6QAN03H0JN6MHT86AF6GRJG/outer/inner/ideal/Idea.md) (`task-artifact-delivery-identity`) |
| R-02 | 当前项目 | 本仓库发布脚本及 GitHub Actions 配置；不是修改 GitHub/npm 平台。 | [统一包接线与发布就绪检查](../../../../01M6QATYFFT1QMS3VESF5D3M0P/outer/inner/ideal/Idea.md) (`package-release-readiness`) |
| R-03 | 当前项目 | Task Engine/pguide 套件发行和安装验证；不修改 npm 的安全策略。 | [按验证过的套件清单安装 Task Engine](../../../../01M6QAXSZKZKJYFGQ0W1NRW3E1/outer/inner/ideal/Idea.md) (`task-engine-suite-manifest`) |
| R-07 | 当前项目 | 仓库消费验证及跨平台执行适配；不把 Shell/SSH 使用失误直接当成平台缺陷。 | [交付受测试的跨平台消费验收工具](../../../../01M6QB0W3XEHEEHGSQ03DQMB9C/outer/inner/ideal/Idea.md) (`task-consumer-verification`) |
| R-08 | 当前项目 | Check SDK、环境包的受测消费范例和诊断。 | [将 Check 消费契约做成可执行范例](../../../../01M6QB3YSB9VXHPRAWHFQG69QJ/outer/inner/ideal/Idea.md) (`check-consumer-contracts`) |
| R-09 | 当前项目 | Task Engine、Probe 生命周期诊断及 CI 测试。 | [诊断 Task 启动与物理回收失败](../../../../01M6QB6YCB1KMNMPWTM8QTJYDB/outer/inner/ideal/Idea.md) (`task-engine-lifecycle-diagnostics`) |
| R-10 | 当前项目 | Engine/Check 的 raw Gateway 资源读取；不依赖 Pinboard 新增 HTTP 文件路径。 | [通过 raw Gateway 按 CID 读取 Check Reference](../../../../01M6QB9ZJ30JANS39FMV8KS1SK/outer/inner/ideal/Idea.md) (`check-reference-verified-read`) |
| R-11-local | 跨项目：本地部分 | 本仓库结构化证据、范围绑定和同源报告；Silvermoon 通用 gate review 单列外部候选。 | [按当前验收范围生成仓库交付报告](../../../../01M6QBD9WBX8TFH5ZSEZGHJ309/outer/inner/ideal/Idea.md) (`delivery-evidence-scope-report`) |

每个子 IDEA 均有独立的 Idea、Implementation、Deployment、ledger 和 alias 事件；原修改建议全文复制到其理想世界的 **Recommendation.md**，只调整相对链接并补充来源和范围说明。来源为父 IDEA 提交 `a5eb19115b212c1675b6ab56cab7c0a28a9ec434`。R-11 全文保留跨项目上下文，但本地 Idea 明确排除 Silvermoon 产品改造。

### 独立身份

| 建议 | IDEA ID | Alias | 本次创建状态 |
| --- | --- | --- | --- |
| R-01 | `01M6QAN03H0JN6MHT86AF6GRJG` | `task-artifact-delivery-identity` | preparing / 未提交 / 未批准 |
| R-02 | `01M6QATYFFT1QMS3VESF5D3M0P` | `package-release-readiness` | preparing / 未提交 / 未批准 |
| R-03 | `01M6QAXSZKZKJYFGQ0W1NRW3E1` | `task-engine-suite-manifest` | preparing / 未提交 / 未批准 |
| R-07 | `01M6QB0W3XEHEEHGSQ03DQMB9C` | `task-consumer-verification` | preparing / 未提交 / 未批准 |
| R-08 | `01M6QB3YSB9VXHPRAWHFQG69QJ` | `check-consumer-contracts` | preparing / 未提交 / 未批准 |
| R-09 | `01M6QB6YCB1KMNMPWTM8QTJYDB` | `task-engine-lifecycle-diagnostics` | preparing / 未提交 / 未批准 |
| R-10 | `01M6QB9ZJ30JANS39FMV8KS1SK` | `check-reference-verified-read` | preparing / 未提交 / 未批准 |
| R-11-local | `01M6QBD9WBX8TFH5ZSEZGHJ309` | `delivery-evidence-scope-report` | preparing / 未提交 / 未批准 |

## 其他项目：待提 GitHub issue 的候选

这里列的是待讨论的 issue 范围和目标，不是已经创建的 issue。Pinboard 和 Silvermoon 仓库已通过 GitHub 元数据核实；未确认的目标明确留空，不因名字相似而指派。

| 候选 | 来源建议 | 对应产品 / GitHub 仓库 | 建议 issue 范围 | 创建前需要明确的事项 |
| --- | --- | --- | --- | --- |
| EXT-01 | [R-04](./recommendations/R-04-auth-capabilities.md) | Pinboard CLI：[shazhou-ww/pinboard](https://github.com/shazhou-ww/pinboard) | 按 endpoint 诊断 API token 与实际能力，区分命令存在、只读可用、写权限未知；给出不泄密的恢复指引 | 与 MCP Portal 分工，CLI 不读取或同步宿主 OAuth |
| EXT-02 | [R-04](./recommendations/R-04-auth-capabilities.md) | MCP Portal / 客户端，**准确仓库待确认** | 区分发现、连接、OAuth 与具体工具能力；按故障层给恢复动作 | 先定位 Portal 与客户端边界；`unknown chat session` 尚不能归因给服务端 |
| EXT-03 | [R-05](./recommendations/R-05-pinboard-import.md) | Pinboard 服务/CLI/MCP：[shazhou-ww/pinboard](https://github.com/shazhou-ww/pinboard) | 严格 CAR expected-root 校验、提交正式 pin 前拒绝错根、回执字节口径及结果未知的查询恢复 | 先核实既有 `cid` 参数语义；不要把本次误用直接写成已确认接口 bug |
| EXT-04 | [R-06](./recommendations/R-06-local-file-upload.md) | 本地 Agent 宿主 / MCP 适配层，**准确仓库待确认**；Pinboard 配合 | 本地授权文件句柄由宿主读取、校验和编码，经已有授权通道发送，避免模型转抄 base64 | 不能让远端服务直接访问本地路径；确定宿主能力与服务配合后再选择 issue 目标，不默认指派给 Copilot SDK、VS Code 或 Pinboard 单方 |
| EXT-05 | [R-11 外部部分](./recommendations/R-11-evidence-scope.md) | Silvermoon：[shazhou-ww/silvermoon](https://github.com/shazhou-ww/silvermoon) | 通用 gate review 展示当前可接受范围、尚缺证据和沿用依据，保留历史而不混淆结论 | 先以本地报告适配验证通用需求；不把 npm/Pinboard 专有字段或自动 acceptance 写进核心事件 |

### 不另行误派的边界

- **R-10** 的主要修复入口在本仓库。Pinboard README 明确描述 raw 块与 CAR 导出能力，未据此承诺任意 HTTP UnixFS 文件路径；本次 404 不是新增 Pinboard 路径路由的充分理由。若要改善能力文档，可作为 EXT-01/EXT-03 的协作补充；浏览器直链需求应另立需求，不作为本地子 IDEA 的前提。
- **R-04/R-06** 的 MCP 连接/本地文件责任不能凭仓库名推断。曾检查 `shazhou-ww/mcp-hub` 和 `shazhou-ww/agent-web-portal`，但现有证据不足以确认它们就是本次 Portal 或 VS Code 宿主的 issue 入口；后者 README 描述的是 MCP 兼容站点框架。
- **R-02/R-03/R-07** 涉及 Actions、npm、PowerShell 和 SSH，不等于应向这些上游平台报 bug。本轮有证据支持的是本仓库交付接线和适配改进。
- 外部 issue 后续应只携带可公开的最小复现与必要回执，不上传凭据、私有配置、整段会话或不相关环境资料。

## 导航

- [父 IDEA](./Idea.md)
- [11 项产品建议总览](./Product-recommendations.md)
- [33 项原始问题及证据](./Acceptance-issues.md)
