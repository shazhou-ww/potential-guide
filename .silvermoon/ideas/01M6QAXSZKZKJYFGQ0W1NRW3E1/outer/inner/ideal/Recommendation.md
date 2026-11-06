> 来源：[R-03 原始建议](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-03-suite-installation.md)，提交 `a5eb19115b212c1675b6ab56cab7c0a28a9ec434`。父 IDEA：[check-delivery-acceptance-followups](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)。
>
> 本副本保留原建议全文；跨产品引用仅说明协作边界，不代表本子 IDEA 承接外部服务改造。

# R-03：以经过验证的套件清单交付 Task Engine

**产品与责任**：Task Engine / pguide 发行与安装体验。**覆盖**：A-08、A-09、A-11，关联 R-02、R-07。证据见[问题清单](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Acceptance-issues.md)的 E3、E4、E7。

## 判断

“安装全套”目前需要操作者逐包决定版本；`latest` 可能还是占位版本，也不代表多个包互相匹配。安装退出 0 或 esbuild 警告都不能单独回答作者工具和运行服务是否可用。这不是要求取消 npm 安全策略，而是让交付组合与实际能力可验证。

## 建议修改

1. 为经过实际发布消费验证的套件输出一份不可混淆版本的清单，包含套件标识、准确包版本、所需 Node 范围、registry 验证来源与时间，以及对应发布/消费证据。由发行流程生成，不能从今天的各包 latest 临时拼成“同一套”。
2. 区分运行服务、编写 Check、完整验收所需的安装范围，明确 CLI 入口与库依赖。不要把本次全局安装的 13 个包无条件复制成所有用户的默认安装要求；使用已有依赖图得到最小闭包。
3. 先提供由清单驱动的安装说明/计划和安装后核验，再按需求决定是否增加安装命令。计划应说明目标目录/前缀、已有版本差异、所需网络；库开发示例优先普通本地 npm 项目，CLI 才使用明确选择的全局或本地入口。
4. 保留 npm 默认脚本策略。安装后分别验证版本图、CLI 启动、作者示例构建；某项不可用时明确指出受影响能力，不自动放开全部脚本。
5. 网络不可达时报告“无法验证”，不要把代理站点 404 当成 registry 中不存在。允许用户在本就获准的执行环境完成验证；不更改设备安全策略或暗中更换下载源。

## 复用入口与取舍

复用[现有消费版本图](../../../../../../scripts/deployment-consumer.mjs)和[发布消费验证](../../../../../../scripts/verify-deployment.mjs)的 packed / published / latest 区分；固定套件走 published 精确版本，latest 检查仍可单独存在。与 [R-07](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-07-consumer-verification.md)共享后验能力，不复制另一套 smoke。

这不是自建包管理器，也不保证任意 RC 组合兼容；只承诺清单中已经验证的组合。用户已有包、配置和服务不得为安装便利而被无提示覆盖。

## 验收方式

- registry 的 latest 被设置成占位版本时，按清单安装仍得到目标组合；任一版本缺失要在完成前明确失败。
- 版本清单与实际依赖图不一致时被指出，不能只检查顶层包名。
- 在默认安装脚本限制下分别执行运行和作者能力探针；缺少能力不被“npm install 成功”掩盖。
- 断网或受限网络返回明确未验证状态，既不返回貌似成功的回执，也不改变策略；安装范围与现有环境差异可供用户审阅。
