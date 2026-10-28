# Deployment

## Steps

### D-S01: 准备独立消费者场景

先将本契约和[复验脚本](./verify-consumer.mjs)同步到 primary，记录执行前的 deploymentRevision 与 Deployment.md blob。使用已 accepted Inner 的现成工具构建输出生成本地 pack，并将工具 pack、作者显式构建的真实 file-content Check 目录/归档和准确摘要交付到源码仓库外新建的操作拥有目录。消费者只从该交付目录以 `pnpm install --offline --ignore-scripts` 安装工具及正常工具依赖，不使用源码链接、NODE_PATH、loader/test hook 或绝对 import checkout/dist；Check 自身没有 node_modules、安装或隐式构建。

### D-S02: 验证准确获取与执行

从独立消费者通过公开 API 执行本地和真实 localhost HTTPS 制品，记录准确来源、逻辑 digest、传输 digest、Host revision、正/负业务结果、References 字节及离线缓存复用。TLS 使用本操作生成的证书，仅在消费者子进程明确受信，不关闭校验。错误逻辑/传输摘要、替换内容、缺失/不可获取来源和损坏缓存必须拒绝，失败准备不得增加 Host 执行计数。关闭本操作的服务/权限 helper，核对拥有标记后删除外部目录、证书与临时文件；将脱敏结果和复验方法作为 Outer 支持证据同步，ledger 只镜像 checkbox。不发布 GitHub Release/npm，不修改已 accepted Ideal/Inner 或实现源码。

## Acceptance criteria

### D-AC01: 无源码依赖消费成功

记录 Windows/Node/pnpm 版本、仓库外消费者绝对位置、工具 pack SHA-256、实际安装的模块 realpath/依赖边界、Check 来源/三类摘要及真实正/负结果。安装输出证明离线且禁用生命周期脚本；消费者实际模块路径必须在外部目录，不指向源码仓库；Check/执行树不包含 node_modules，References 与作者交付清单逐字节摘要一致。由复验脚本断言及保存的外部结果证明。

### D-AC02: 异常不会变成成功证据

逐场景保存失败类别、Host 执行计数不变、无成功 capsule/无成功业务证据，验证正确缓存可在源服务关闭后复用。保存真实 HTTPS 请求记录、服务停止与整个操作拥有外部目录/证书删除的检查结果。所有 D-* 完成后提交并同步准确 deploymentRevision，再记录 submitOuter；不把这些检查或 checkbox 当作 acceptOuter。
