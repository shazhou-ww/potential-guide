# Implementation

实施采用 canonical `https://shazhou-ww.github.io/potential-guide/schemas/<format>/v1.json`；
定义源位于仓库 `schemas/objective/v1.json` 与 `schemas/objectives/v1.json`，
协议包携带字节一致的离线副本与生成定义。Pilot 执行角色、包名和既有
`--pilot`/`scaffold pilot` 命令名称保留；本轮只统一目标数据引用。
验证与明确拒绝的迁移边界见 [Evidence.md](./Evidence.md)。

## Steps

### I-S01: 统一定义和引用契约

将入口改为 `objective.yaml`，使用 `$schema`、`subjectSchema` 与 `levels[].checks`。
采用 `json-schema-typed` 的 Draft 2020-12 类型并显式要求根对象；Ajv 严格编译、
文档结构校验和 subject 实例校验各有职责，不允许任意远程 schema 获取。
声明、Portfolio、Regulator、队列、报告和恢复快照中的目标数据引用统一为 objective；
保留 URI、directory tree、retrieval commit 与 repositoryTree 的独立证据意义。

### I-S02: 贯通入口和显式迁移

同步作者文件、脚手架、独立运行时、导出清单、打包消费样例及文档。
`objective-contract-migrate` 对 manifest、声明和非固定版本 Portfolio 进行显式转换；
输入不修改，输出以排他创建拒绝覆盖，未知字段及无法保持语义的情况明确失败。
固定来源的 Portfolio 和旧恢复/报告/队列证据不得凭字段改名伪造新 commit/tree：
保留原始证据，先提交迁移后的目标，再显式重新绑定和观察。

### I-S03: 验证观察与恢复行为

验证有效/非法/未知 URI/旧格式边界、迁移的非破坏性与来源拒绝策略、
Pilot/Regulator/Portfolio 的实际观察、跨进程固定来源及 continue 恢复。
运行目标测试、`pnpm check` 和独立 tarball 消费检查。
Pages 工作流只构建并发布 `/schemas/...`，在发布前比对已公开字节和索引，
禁止覆盖或删除已发布定义；真实公共获取及部署验收留在 Deployment。

## Acceptance criteria

### I-AC01: 新契约一致可消费

通过类型检查、结构/语义测试、Pilot/Regulator/Portfolio/CLI 集成及固定来源恢复，
证明新定义及全部目标引用一致，不改变检查顺序、推进和来源证据语义。

### I-AC02: 旧格式拒绝且可迁移

反例覆盖旧入口、字段与未知 URI；迁移测试证明顺序、schema 与字符串常量不被误改，
原始输入和已有输出不受失败影响，固定来源不被猜测或替换。

### I-AC03: 包与定义保持一致

生成一致性、不可变发布检查及独立 tarball 消费证明 schema 随包可用、
离线可编译且 URI 映射一致；仓库要求的检查通过。
这些构建证据不等同于公共 Pages 部署或 npm 发布。
