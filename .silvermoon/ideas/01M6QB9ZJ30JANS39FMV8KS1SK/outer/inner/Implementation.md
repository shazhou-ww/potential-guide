# Implementation

## Steps

### I-S01: 明确公共读取与 Check 解释边界

核对当前 Engine 公开 block client、内部 UnixFS 读取和 Check 资源约定，选择可由独立消费者导入的窄入口。底层不解释 check.json、Task 或 Run；Check 层校验索引及声明语言，不暴露宿主配置或引入类型注册。

### I-S02: 落实改动与针对性回归

复用标准 CID/块验证及 UnixFS 字节流，保留取消、路径、块数和字节预算；Check 层解释 resources/check.json 并选择声明语言和资源。历史验收脚本作为输入，不复制为第二套私有 DAG 协议。

## Acceptance criteria

### I-AC01: 公共入口保持内容与业务分层

以包导出和独立消费测试证明入口受支持、根到文件的 DAG 与字节受验证，Check 索引解释不进入底层 IPFS 接口；文档区分已有读取证明与新 API 的交付状态。

### I-AC02: 回归保持既有保护

使用 raw-only Gateway fixture 及损坏/缺块负例，保持路径、容量、时限、取消和禁止额外节点的约束。 适用的仓库检查通过，未降低既有约束。
