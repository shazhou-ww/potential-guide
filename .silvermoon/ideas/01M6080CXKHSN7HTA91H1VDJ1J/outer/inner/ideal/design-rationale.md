# 内置内容迁移与 Release 交付的设计逻辑

## 为什么单独验收交付

[Check 制品](../../../../01M607T630T6DSDZYTYA52ED6J/outer/inner/ideal/Idea.md)解决独立执行内容如何交付，[Objective 组合](../../../../01M607XBNKWQDZAC6EPTZ474NH/outer/inner/ideal/Idea.md)解决如何固定组合和提供场景化 References。本项解决这些能力是否真正成为内置内容和用户工作流的默认交付方式。

三项依次推进，但不把“所有内容迁移完毕”作为底层能力的首个验收条件，也不以新 API 存在来代替实际发布。

## 发布的是制品，不是源码生成物

Git 保留可审查的源码、原始 References、manifest 和构建配置；生成 worker 及压缩包不提交源码树。CI 从准确来源提交构建、验证后上传 GitHub Release assets。

GitHub Release 是第一种托管渠道，不是协议里的 registry。压缩包承载自己的 manifest；无需发布业务 npm 包。已有工具和共享开发库仍可以保留 npm 工作区或发布方式，不能机械删除所有 `package.json`。

## 内联 digest 对发布顺序的影响

先构建 Check 并取得准确摘要，再使 Objective 的内联声明指向该内容和交付地址，最后生成 Objective 制品。不能先发布浮动引用，等待消费端 resolve 或生成 lock。

发布准备必须明确最终声明在哪个可审查的来源中形成，并避免自引用摘要或构建过程静默改写已签定的 manifest。实现阶段确定具体版本和 tag 命名，不在准备阶段虚构命令或字段。

Check 与 Objective 可以同次流水线交付，但 Objective 可用性必须以其全部必需依赖可获取为条件。平台不能保证多文件原子发布时，应明确候选、完成和失败状态；不能以部分上传成功宣称整套可消费。

## References 与迁移范围

迁移需覆盖所有现存内置 Check、Objective、跨 Objective 依赖和消费声明，而不只修改发布脚本。通用 Check/problem References 下沉到 Check；Objective 与 level 说明及场景覆盖留在 Objective，并保留语言和链接的正确性。

旧 npm 来源、Git 目录 URI、包名和历史摘要不能被重写成新制品身份。明确区分新增消费的迁移策略与已有任务的恢复策略；不承诺永久保留全部旧入口，但任何退出必须有明确错误与操作说明。

## 用户侧闭环

作者通过脚手架创建、显式构建并发布制品；消费者只安装工具，获取准确内容即可检查。验证必须从源码目录之外、没有业务包依赖的环境开始，并实际下载 Release assets。

本地 fixture、临时 HTTP、CI 打包成功都不能替代真实 Release 获取证据。外部权限或发布授权缺失时记录阻塞，不绕过授权或谎称交付。

## 不扩展为另一个包管理系统

本项不建设版本范围求解、registry 服务、镜像网络、通用安装脚本或签名平台。离线全集导出可以未来基于相同准确引用增加，不要求用户在当前迁移中学习第二套依赖文件。
