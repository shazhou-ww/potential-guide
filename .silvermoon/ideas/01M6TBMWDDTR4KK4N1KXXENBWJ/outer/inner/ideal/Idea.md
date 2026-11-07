# 让 Task Engine 经多 Gateway 可靠消费 Bundle

## 问题

服务命令只配置单个 Gateway；消费走查又把本地 Kubo 当作必需，增加环境准备成本。
远程 Gateway 不可用时也缺少操作者可配置的替代来源。

## 结果

Engine 支持操作者配置多个可信 Gateway，在来源故障时有界切换，保持根 CID 为唯一内容身份。
普通消费设备只需 Node.js（含可用 npm），使用预先交付的 Bundle CID 和可用 Gateway；Pinboard 经兼容性实测后可作为来源。

## 边界

1. 仍为 Gateway-only，逐块校验 CID；本地 Kubo、发布/import/pin 属于可选交付方职责，不进入消费 prerequisite。
2. 故障切换有总预算、可取消、错误可定位；Request hint 不自动获得网络访问权限。
3. 不扩展为节点管理或负载均衡；不把 stable/RC 通道、操作系统或相同包版本号作为消费前提。

## 验收标准

1. 首选来源故障时可从可信备用来源获取同 CID 内容；全部失败、损坏内容或取消均明确终止，不误报成功。
2. 在未安装或不调用本地 Kubo 的设备，仅凭 Node/npm、精确发布组合、Gateway 和 CID，完成基础 Check 与重启恢复。
3. Pinboard 的 raw-block 和完整 DAG 可用性有实测证据；文档区分外部服务条件与设备依赖。
