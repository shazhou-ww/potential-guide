# CLI 拆包消费验证

本文支持 [Deployment.md](./Deployment.md)，记录打包消费结果，不声称已发布 npm、迁出仓库或完成真实模型部署。

## 验证对象

- 源码提交：`8748d6b17c9d61e7f1c6890e006d8820cc7bb25a`，包含已同步的部署契约、三层拆包、并发治理迁移整合及冷缓存修复。
- 执行命令：`pnpm install --frozen-lockfile`，随后 `pnpm deployment:verify`。
- [准确提交的 CI 运行](https://github.com/shazhou-ww/potential-guide/actions/runs/39425858269)。
- 15 个内部发布包均使用该提交构建的本地 tarball；版本以[该提交的发布清单](https://github.com/shazhou-ww/potential-guide/blob/8748d6b17c9d61e7f1c6890e006d8820cc7bb25a/scripts/release-packages.mjs)及各包清单为准，不从 npm 下载内部包冒充本次产物。
- 第三方依赖允许按正常消费者语义下载缺失的兼容版本；安装脚本关闭，内部包强制本地 tarball。首次全离线运行因冷缓存缺少 fast-uri 失败，修复后重新验证，未将首次失败记为通过。

本次产物版本：

| 包 | 版本 |
| --- | --- |
| effects、git-source、pilot-protocol、cli-runtime、objective-declarations | 0.1.0-rc.0 |
| objective-pilot | 0.2.0-rc.0 |
| cli-core、config | 0.3.0-rc.0 |
| pguide、objective-regulator、objective-portfolio-supervisor、pguide-pilot、pguide-regulate、pguide-supervise、pguide-objectives | 0.4.0-rc.0 |

除 pguide 外，以上 npm 名称均带 `@potential-guide/` scope。版本号不能替代源码提交：相同 RC 清单版本的本地产物以准确提交及该次 CI 构建区分。

## 跨平台结果

| 环境 | Node.js | 消费结果 | 证据 |
| --- | --- | --- | --- |
| Ubuntu hosted runner | 22.13.0 | 八组合及完整打包部署检查通过 | [作业记录](https://github.com/shazhou-ww/potential-guide/actions/runs/39425858269/job/118639994837) |
| macOS hosted runner | 22.13.0 | 八组合及完整打包部署检查通过 | [作业记录](https://github.com/shazhou-ww/potential-guide/actions/runs/39425858269/job/118640003943) |
| Windows hosted runner | 22.13.0 | 同提交重新运行后，八组合及完整打包部署检查通过 | [作业记录](https://github.com/shazhou-ww/potential-guide/actions/runs/39425858269/job/118639939252) |

Windows 首次运行已通过八组合，在后续已有 snapshot 场景触发 10 秒外部命令超时；仅重跑该 Windows 作业，同一源码提交通过。没有修改生产超时、跳过测试或把首次失败隐藏为成功。

本机 Windows 另由父 Agent 执行整合后的 pnpm check 和 deployment:verify，通过；冷缓存修复后再次执行 pnpm check，通过。

## 安装组合与入口

| 消费组合 | 内部依赖闭包 |
| --- | --- |
| 仅协议 | 1 个包；可调用 Pilot 定义、schema、校验和声明绑定；没有业务执行或 CLI |
| 仅主入口 | 2 个包；没有强制安装业务命令；probe 缺失时明确提示安装 pguide-pilot |
| 仅 Pilot 命令 | 8 个包 |
| 仅调节命令 | 9 个包 |
| 仅监督命令 | 11 个包 |
| 仅声明命令 | 4 个包 |
| 仅配置命令 | 2 个包 |
| 主入口及全部命令组 | 15 个包 |

每个命令包单独消费其公开入口；组合消费使用包管理器生成的真实 shim，验证主入口发现、八个子命令分发、metadata 兼容与独立入口。PATH 隔离本机全局扩展，不借用仓库源码链接。

安装方式迁移的可验证边界是：过去仅安装 pguide 便拥有业务命令，现在必须按文档显式选装命令包；main-only 验证缺失提示，逐组与 combined 验证补装所需的实际依赖和入口。没有声称测试了尚未公开发布的新版本的 npm registry 升级，也没有把 config 静默改名。

完整部署验证还覆盖 npm 消费后的观察、ACP 调节与继续、持久化、监督、已提交 Pilot 子目录加载及 setup/self-check 夹具。以上使用测试 Agent，不代表真实模型或外部设备验收。

## 未掩盖的 CI 基线问题

整个 CI workflow 不是全绿：Node.js 22/24 的完整检查仍有进程启动、总观察预算及调节时间配额相关的计时失败；部分后续测试被 Turbo 终止。不得把上述 Packed CLI 三平台成功表述为整个 CI 成功。

[拆包前基线运行](https://github.com/shazhou-ww/potential-guide/actions/runs/39419365652)在提交 `519e98eeca84414e266c76ea81a7eba7ec91dde6` 已出现相同的 real process dependency 总预算和 time quota 失败。协议/命令迁移没有修改这些生产预算或相关测试；本轮不扩展为修复原有计时测试。当前部署验收依据本轮直接相关的三平台真实打包消费结果，并明确保留这一风险。
