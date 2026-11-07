# 建议归属与子 IDEA

## 分类结论

本页的创建状态、issue 回读和原建议归属均绑定其记录时点，不是实时生命周期投影。当前状态由 Silvermoon 查询；原始方案中的旧 Probe 适配入口不恢复，R-10 按已完成公共读取证明收敛为公共消费入口。父级只维护归属和证据，不承接子 IDEA 的源码整改或接受。

当前项目是 **shazhou-ww/potential-guide**。11 项建议中，**7 项完全属于本仓库、3 项主要属于其他项目、1 项跨项目**；跨项目 R-11 拆出本地报告适配后，共创建 **8 个本仓库子 IDEA**。

本次按用户要求创建和复制方案，不实施产品改动，不提交或接受子 IDEA。用户随后授权直接创建外部 issue，并要求跳过归属不确定的项；现已创建下表三条 issue，另两项明确跳过。父子关系以总览和子 IDEA 的双向链接表达：当前 Silvermoon CLI 没有 parent 创建选项，未擅自增加 schema 字段、父子事件或嵌套目录。各子 IDEA 是独立的平铺构想，父级不会替它们自动审批。

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

## 其他项目：GitHub issue 与跳过项

2026-11-06 已核对 Pinboard 和 Silvermoon 仓库及既有 issue，创建后逐条回读并确认正文与提交内容一致、状态为 Open。归属未确认的 EXT-02、EXT-04 按用户要求跳过，不因名字相似而指派；这里记录的是创建时点，不承诺 issue 后续状态不变。

| 编号 | 来源建议 | 对应产品 / GitHub 仓库 | Issue 范围与边界 | 结果 |
| --- | --- | --- | --- | --- |
| EXT-01 | [R-04](./recommendations/R-04-auth-capabilities.md) | Pinboard CLI：[shazhou-ww/pinboard](https://github.com/shazhou-ww/pinboard) | 按 endpoint 诊断 API token 与实际能力；CLI 不读取或同步宿主 OAuth | 已创建 [shazhou-ww/pinboard#6](https://github.com/shazhou-ww/pinboard/issues/6) |
| EXT-02 | [R-04](./recommendations/R-04-auth-capabilities.md) | MCP Portal / 客户端，**准确仓库待确认** | 区分发现、连接、OAuth 与工具能力；`unknown chat session` 尚不能归因给服务端 | **按用户要求跳过，未创建** |
| EXT-03 | [R-05](./recommendations/R-05-pinboard-import.md) | Pinboard 服务/CLI/MCP：[shazhou-ww/pinboard](https://github.com/shazhou-ww/pinboard) | 新增明确 CAR expected-root 约束，完善回执口径；不重建已有完整 DAG 校验及恢复机制 | 已创建 [shazhou-ww/pinboard#7](https://github.com/shazhou-ww/pinboard/issues/7) |
| EXT-04 | [R-06](./recommendations/R-06-local-file-upload.md) | 本地 Agent 宿主 / MCP 适配层，**准确仓库待确认**；Pinboard 配合 | 本地授权文件由宿主校验后走现有通道直传；不让远端服务访问本地路径、不默认指派给某一宿主产品 | **按用户要求跳过，未创建** |
| EXT-05 | [R-11 外部部分](./recommendations/R-11-evidence-scope.md) | Silvermoon：[shazhou-ww/silvermoon](https://github.com/shazhou-ww/silvermoon) | 通用 gate review 展示可接受范围、证据缺项和沿用依据；本地报告仍由本仓库子 IDEA 负责 | 已创建 [shazhou-ww/silvermoon#18](https://github.com/shazhou-ww/silvermoon/issues/18) |

### 提交前的事实校正

Pinboard 当前 [MCP 文档](https://github.com/shazhou-ww/pinboard/blob/main/docs/mcp.md)明确说明 `upload.cid` 用于 **block mode**，不是 CAR expected-root 断言；[CLI 文档](https://github.com/shazhou-ww/pinboard/blob/main/docs/cli.md)也已包含服务器 DAG 校验及 publication 部分成功/请求恢复机制。因此 EXT-03 按新增严格导入能力提出，不把本次传错参数归为已确认接口违约，也不重复建议已有恢复协议。三条 issue 均使用必要的公开现象和验收场景，没有附带凭据、私有配置或整段会话。

### 不另行误派的边界

- **R-10** 的主要修复入口在本仓库。Pinboard README 明确描述 raw 块与 CAR 导出能力，未据此承诺任意 HTTP UnixFS 文件路径；本次 404 不是新增 Pinboard 路径路由的充分理由。若要改善能力文档，可作为 EXT-01/EXT-03 的协作补充；浏览器直链需求应另立需求，不作为本地子 IDEA 的前提。
- **R-04/R-06** 的 MCP 连接/本地文件责任不能凭仓库名推断。曾检查 `shazhou-ww/mcp-hub` 和 `shazhou-ww/agent-web-portal`，但现有证据不足以确认它们就是本次 Portal 或 VS Code 宿主的 issue 入口；后者 README 描述的是 MCP 兼容站点框架。
- **R-02/R-03/R-07** 涉及 Actions、npm、PowerShell 和 SSH，不等于应向这些上游平台报 bug。本轮有证据支持的是本仓库交付接线和适配改进。
- 外部 issue 后续应只携带可公开的最小复现与必要回执，不上传凭据、私有配置、整段会话或不相关环境资料。

## 导航

- [父 IDEA](./Idea.md)
- [11 项产品建议总览](./Product-recommendations.md)
- [33 项原始问题及证据](./Acceptance-issues.md)
