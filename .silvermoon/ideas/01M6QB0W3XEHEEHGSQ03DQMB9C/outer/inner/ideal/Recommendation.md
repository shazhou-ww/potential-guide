> 来源：[R-07 原始建议](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-07-consumer-verification.md)，提交 `a5eb19115b212c1675b6ab56cab7c0a28a9ec434`。父 IDEA：[check-delivery-acceptance-followups](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Idea.md)。
>
> 本副本保留原建议全文；跨产品引用仅说明协作边界，不代表本子 IDEA 承接外部服务改造。

# R-07：把消费验收从临时脚本升级为受测试的交付工具

**产品与责任**：仓库消费验证工具；如需随产品分发，由 pguide 交付入口承接。**覆盖**：A-20、A-21、A-22、A-23、A-24、A-25，关联 A-11、A-33。证据见[问题清单](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/Acceptance-issues.md)的 E3、E4、E8。

## 判断

本次多次失败并非业务执行失败，而是临时脚本的 CRLF、Shell 引号、编码、ESM 解析和自由变量错误。继续写更多一次性脚本，会让验收质量依赖操作者记忆。仓库已有消费测试和跨平台执行帮助器，缺的是能被实际交付过程复用、验证自身可靠性的入口，不是新建通用远程运维平台。

## 建议修改

1. 收编现有验证逻辑为版本化的 Node/TypeScript 验收入口，复用[消费验证](../../../../../../scripts/verify-deployment.mjs)、[执行帮助器](../../../../../../scripts/verify-deployment-helpers.mjs)和[服务消费者](../../../../../../scripts/check-task-service-consumer.mjs)。先在仓库工具中稳定，再决定是否暴露产品命令；不要直接复制会话脚本作为正式 API。
2. 用受校验的 UTF-8 配置文件传 endpoint、包清单、工作目录和用例，避免 PowerShell → SSH → Bash 的多层字符串拼接。尽量在目标设备本地运行同一入口，SSH 仅负责获准的传输与启动；不加入自动发现私钥或修改用户 PATH 的功能。
3. 启动前输出实际 Node/工具路径、版本、导入条件和目标目录，发现非交互环境与预期不一致就明确停止。库消费者在普通本地项目内使用公开 ESM exports，避免依赖全局包的非标准解析或深层内部路径。
4. 分阶段验证安装、CLI/UI 就绪、业务执行、Reference、物理清理。每阶段先持久化有界结果，再进行下一阶段；报告代码异常应标为验收工具故障，不能吞掉已完成的运行事实，也不能让总结果变成功。
5. 把工具本身纳入 lint/typecheck 和实际小型运行测试，覆盖报告落盘失败、未定义变量类静态错误、启动失败与 cleanup 失败。记录阶段完成状态、原始失败类别及持久化是否成功，不只执行 `node --check`。
6. 所有临时资源有明确所有权；仅关闭本次 PID/端口和删除本次工作目录内的确定文件。正常与异常退出均验证清理；无法确认物理释放时保留失败和诊断。

## 取舍与边界

与 [R-03](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-03-suite-installation.md)分工：套件清单决定版本，本工具消费它并证明能力；与 [R-10](../../../../01M6Q8VHHGG4G49XZE1VWS3W2Z/outer/inner/ideal/recommendations/R-10-reference-reading.md)分工：Reference 阶段使用正式读取方式，不私自假设 Gateway 路径路由。测试可以用可控 fixture，公共可用性证明则必须显式启用真实 endpoint，二者报告不能混同。

不新增 daemon、远程 credential manager 或自动修改全局配置。更好的验收工具应减少业务外副作用，而不是增加隐式运维。

## 验收方式

- 同一配置在 Windows 和 Ubuntu 可运行，中文/空格路径、UTF-8 文本与无交互 PATH 情况均有覆盖。
- 错 Node、不可导入包和缺入口在业务运行前被清楚区分；正常消费不需要 experimental resolver。
- 首个用例成功、后续 Reference 失败时，保留首个 Request/Task/Run、结果和回收证据，总结果仍失败。
- 报告写入故障、服务启动中断、取消和清理超时均有可定位结果；不遗留本次服务，不触及其他用户资源。
