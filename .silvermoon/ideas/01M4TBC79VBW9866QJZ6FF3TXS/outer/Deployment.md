# Deployment

## Steps

### D-S01: 同步已验证的软件包套件

在不发布到注册表的前提下，将已接受的实现及其软件包产物同步到配置的 primary 分支。

### D-S02: 验证隔离的软件包消费

打包三个 workspace，并在隔离的 consumer 项目中安装产物；consumer 导入每个声明的公开入口。

## Acceptance criteria

### D-AC01: Primary 包含已接受的套件

已接受的 implementation commit 可从刷新后的 primary 到达，且三个软件包 manifest 和生成的产物均对应这一 commit。

### D-AC02: 打包产物可协同工作

隔离 consumer 安装打包产物，解析声明的依赖链，导入每个软件包，并成功运行代表性的 Guide→Regulator→Portfolio 流程。
