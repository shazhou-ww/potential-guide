# Deployment

实施已按准确 Inner `282fc60f2e22da55ae4e2775e4c62567d641fcb7` 接受。
以本地 tarball、仓库外新建消费目录、非敏感 TypeBox 样例和本次自有的
offline Kubo 节点执行以下验证。Kubo 仅使用新的数据目录与 loopback 动态端口；
不发布 npm，不使用用户现有仓库作为输出目录，不接管其服务、配置、pin 或 IPFS 数据目录。
执行结果保存在同世界的外部验证记录；此前 Inner 的内存节点不能代替这里的真实节点。

## Steps

### D-S01: 验证独立作者 CLI

在仓库外安装本地包产物，通过 pguide 发现和独立 binary 检查、构建 TypeBox 样例，
记录生成声明、精确清单及 CID；增删资源后重建核对完整成品。
离线 check/build、重复构建与不同作者根采用相同受控产物版本；
记录实际 Node/Kubo 版本及本地包身份，不将 npm 发行版本当作本轮候选。

### D-S02: 验证仅凭成品发布与消费

将 dist 复制至不含源码的消费目录，经 publish 导入受控 Kubo；
另由测试调用方提交 CID 给独立 Engine 验证执行，不把执行混入发布命令。
独立宿主仅安装 Engine/IPFS 必要依赖，不能解析作者 CLI、TypeBox 或 SDK。
检查真实 pin、逐文件发布前后字节、缺失/额外文件拒绝；
结束后关闭本次拥有的验证资源并检查进程退出，不影响用户已有节点。

## Acceptance criteria

### D-AC01: 作者工作流独立可用

以命令、产物清单和重复构建 CID 证明不需顶层手写 task.yaml 或 include 更新命令，
pguide 与独立 binary 行为一致，构建不要求连接 IPFS。

### D-AC02: 发布和执行边界可核验

以发布回执、节点 CID/pin 和独立 Task 结果证明只从 dist 发布且内容一致；
缺失/额外文件拒绝发布，发布过程不求值作者模块、不创建 Task。
