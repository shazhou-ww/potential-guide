# 本地安装交付验证

## 交付边界

本轮交付为 primary 上的已验收实现和经过独立打包安装验证的本地候选；没有发布 npm、修改生产服务、购买 API 服务或申请凭据。

实现提交为 `54afc420c18855c2c60c3c5bdd7c60ddb3f1c63c`，实现验收已在 primary 提交 `65fb8cbb4419d0afa94238b63c135f7b596ec604` 记录。所有业务源代码在部署阶段保持不变。

## D-AC01: 安装后入口可用

在 Windows x64、Node.js 24.12.0、pnpm 11.22.0 下，对已验收 primary 执行 `pnpm deployment:verify`，退出码为 0。

命令将八个本地包打包后安装到独立 consumer，而不是从源码目录导入；验证公开导出、命令发现、直接命令和 dispatcher 入口，随后清理自己创建的验证目录。

实测结果：

- 八个库的打包文件分别为 7、7、31、7、23、15、7、63 个，安装后独立导入成功。
- regulator 的真实 ACP 测试替身执行、多轮观测与恢复、持久化、retention、敏感值脱敏及报告验证通过。
- 新 supervisor 的 ACP planner 从标准 session/update 文本片段生成计划，安装后的一次规划与有界执行命令均成功。
- 已达标目标返回 terminal，优先队列为空且没有产生执行事件；一次规划报告为 planned，有界监督报告为 executed，schemaVersion 均为 3。
- 命令最终输出 `deployment verification passed`，未遗留验证进程或独立 consumer。

## D-AC02: 可追溯交付

实现及验收记录均已推送 configured primary。部署契约和本证据同步后，对准确的稳定 deployment revision 再运行相同验证；完成情况记录于 idea 根 ledger，避免执行清单修改改变世界 revision。

范围限制：这是本地安装产物验收，不代表真实规划模型的业务效果、生产环境上线或 POSIX 平台验收。生产模型、外部通知通道及能力建设的权限审批仍由使用方配置。
