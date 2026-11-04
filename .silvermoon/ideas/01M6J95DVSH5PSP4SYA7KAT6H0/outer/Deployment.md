# Deployment

本轮边界是 Engine 统一业务校验，不再要求 Worker 自带 validator。本契约未完成，
不能把仓库内测试或修改构想当成实施接受、部署事实或 npm 发布授权。

## Steps

### D-S01: 验证独立消费环境

从已接受且同步的实现生成实际包，在仓库外通过公开 pguide-task-bundle CLI/API init、
author check/build/artifact check，验证 SDK 明确依赖、独立类型检查和自定义委托封装。
构建工具可依赖 Ajv；SDK 不提供构建/制品/发布子路径。

### D-S02: 验证真实 Engine 数据职责与隔离执行

把完整 Bundle 复制到独立执行目录，通过真实 Engine 验证 CID/DAG、声明握手、
input/message 投递及 result/checkpoint/failed.result 接纳。执行阶段断网，不依赖作者
源码、contract 或构建工具。宿主自己的已声明 Schema/CID 依赖允许存在，但 Worker
只能使用 Bundle 和 Node 内置模块。最低 Node 与当前支持环境均验证有效数据及
非法数据/NACK 的明确失败、物理退出、资源回收；不以 permissive mock 替代宿主。

### D-S03: 固化来源与完整交付证据

记录包摘要、来源提交、Node、CLI 配置/隔离条件、全套命令、Worker/全部 Bundle
字节和实际事件。默认类型导入、代表性引用/组合及作者 validator opt-in 分开归因。
错误结果与负控制不得伪装通过；正式发布另走独立授权。

## Acceptance criteria

### D-AC01: 实际包可消费且 Worker 自包含

独立项目仅用真实包及声明依赖完成 init/check/build，入口显式调用 SDK 或其委托，
均只启动一次。完整产物无作者/构建源码和全局依赖也可执行；默认 Worker 图无
schema-runtime、自动 validator、Ajv、multiformats 或外部加载，opt-in 单独证明。

### D-AC02: Engine 校验及拒绝生命周期成立

真实 Engine 对非法 input/message 在投递前拒绝，对非法 complete/checkpoint/
RunFailure 证据在接纳前拒绝；捕获/忽略 NACK 不导致成功、持久化非法数据或悬挂。
在最低 Node 和当前环境证明最终 failed、物理 exit/reclaimed，以及有效任务的日志、
取消、消息、资源流。自定义宿主必须明确实现同等职责，不能借 Worker 做重复业务校验。
额外验证可克隆但非 JSON、超深和超大载荷由宿主 NACK，无法克隆的载荷在发送端
拒绝后仍可继续上报失败或有效日志，不出现序号断档。日志及进度由宿主检查；
宿主验证的是 structured clone 后的表示，不保证保留原对象描述符。

### D-AC03: 体积及来源可追溯

独立消费默认模板的 Worker 和全部 Bundle 字节低于同环境旧包基线，不借旁路/外部
依赖转移。包摘要、提交和依赖图与实际输出对应，声明/引用仍绑定，解释与实施阶段
数据的差别。不给所有业务任务作统一降幅承诺，不以 gzip 或仓库内测试替代此验收。
