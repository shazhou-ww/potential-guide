# Deployment

独立消费验证计划；在实施门限通过后执行，门限由主 Agent 按[本 session 授权](inner/ideal/Discussion.md)审批。不代表已经部署，不发布 npm 包或修改无关生产服务。

## Steps

### D-S01: 准备独立消费环境

使用[打包驱动](evidence/pack-schema-consumer.mjs)，把当前已验收实现的 task-engine-server、check-task、probe-task 及内部依赖闭包打成 tarball；在本 session 新建的独立目录安装，记录包及入口摘要，禁止解析回源码工作树。不使用其他 session 的服务或数据库。

### D-S02: 验证公开契约闭环

运行[独立消费者](evidence/verify-schema-consumer.mjs)，以自有 SQLite 和系统分配端口启动真实服务；验证鉴权发现、当前版本、If-Match 失配拒绝、非法输入、幂等、terminated 事件共享及准备失败。包含普通对象及 URL/digest 参数，不依赖资产查询或消费者自动下载制品；关闭重开 SQLite 后验证历史身份，不实现浏览器 UI。

### D-S03: 记录结果并清理资源

记录准确候选、包摘要、断言结果和失败/修正记录；确认服务关闭、端口不再响应、SQLite 连接关闭，保存可重放证据后清理本次独立安装目录。仅回收本次拥有的资源，不发布 npm 包。

## Acceptance criteria

### D-AC01: 独立消费者可发现并使用契约

以包解析路径/摘要和真实 HTTP 断言记录证明发现内容与接收行为一致，未认证 401、未授权 403、修订失配 412、结构非法 400 和幂等冲突 409 均明确失败；区分 Schema 提交拒绝与已授权 Probe 摘要冲突的准备失败，并证明无制品 resolve/download。

### D-AC02: 迁移与资源隔离可核验

以自有 SQLite 关闭重开成功、同版本替换 Schema 后 unsupported_contract、真实服务关闭后端口不可达及清理记录，证明没有静默重解释历史绑定，也未影响其他工作树、服务及数据。
