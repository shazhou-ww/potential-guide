# 实施证据

本文件对应 Implementation 的 I-S01–I-S03 与 I-AC01–I-AC03，不变更已验收 Ideal，也不构成审批。外部安装消费验证属于下一阶段；本阶段未发布 npm、未使用真实 Agent/凭据、未部署真实目标。

## 设计与边界

- `canonicalObjectiveUri` 只处理目录身份；`pilotResourceUri` 与 `canonicalManifestUri` 处理真实资源。Git URI 的 repository 按原协议规范化、fragment 按解码路径验证并重新编码；根目录为 `#/`，目录末尾 `/` 唯一，旧 manifest ID 及逃逸/歧义明确拒绝。本地 CLI 仅对 pilot.yaml 精确转换，不剪裁其他文件名。
- `GitSnapshot.treeOid` 从已取回 commit 的实际 tree 读取；`""` 与 `"."` 均为根 tree，文件/链接/子模块不是目录。目录 tree 是 `PilotSpec.version`，取回 commit 从 `GitPilotSource` 获取，不能互换。绑定缓存按 repository + 精确 commit 分隔；同 repo 多目录、不同 commit 的取回不会串用。
- Git 观察的 `sources` 使用完整 tagged 证据，裸哈希不证明对象种类。Git-bound 依赖、Regulator 与 Supervisor 都校验证据及快照归属；自定义内存/HTTP 测试版本没有 Git source，不伪报为已验证 tree，也不能用于 CLI 恢复。
- 当前执行 materialize 整个仓库，因此目录外支持文件独立记录为 `repositoryTree`。它不是 Pilot 的内容版本：无关 commit 不改变 `version`；支持树变化可保守触发运行配方刷新。目录外其他 Git 仓库通过依赖协议取得独立证据。运行环境、网络、外部安装不由这些 Git 哈希覆盖。
- `bindObjective` 先校验任意 JSON 类型的 inputSchema，再使用已有有预算、无进程/网络/文件能力的 JSONata 确定性 profile，最后校验 object subject 的 domainSchema。缺失投影字段报错。Unit 识别空对象约束、const {}、单值 enum [{}]，省略时仅补 `{}`；普通可选字段对象不被误认为 Unit。
- context 只有 repository、checkout、directory；checkout ID 摘要包含主机名、规范化 common Git 目录与 checkout 路径，不能仅凭相同本机路径跨设备合并，也不声称是密码学设备认证。
- 单次绑定不刷新 HEAD。Supervisor 在明确边界替换 spec/runtime 与依赖需求，清除旧版本的等待证据并重新观察；旧执行结果不能解除新需求。刷新错误可见，没有脱离 scope 的后台刷新进程。
- schemaVersion 3 的恢复记录包含原 subject/摘要、声明快照/内容 SHA-256、context/input、根来源与所有已绑定依赖的来源表。跨进程 goal、RegulationInput 和 worker 也携带来源表。旧 schemaVersion 2、旧 manifest ID、缺失/伪造 Git 来源证据拒绝并指导新建运行。
- config.objectives 保留只读来源别名查询与删除，不自动解释为声明；add/update 已退役。`objectives migrate` 要求提供绑定意图完整的新声明和具体旧配置文件，先原子保存新清单再删除同名旧项；若第二次保存失败，数据仍在两处而不是先被删除。其他别名保持不变。

## Identity-impact 必需验证矩阵

| 验收场景 | 实现与证明 |
| --- | --- |
| 同目录不同引用、尾斜杠、编码、仓库根、Windows 路径、危险路径 | `objective-pilot/test/identity.test.ts` 验证规范化、默认 HTTPS 端口/主机名、资源地址独立、旧 ID/逃逸拒绝；`pguide/test/pilot-source.test.ts` 的 repository-root 测试实际加载 `#/` 并对照根 tree。 |
| manifest、检查脚本、References、目录资源每类变化 | pilot-source 的 folder-tree 测试依次提交四类修改，逐次断言 version 改变并等于实际目录 tree；已有 immutable snapshot 测试在绑定后修改工作树，观察仍来自原快照。 |
| 无关文件、目录移动、相同内容不同目录 | 同一 folder-tree 测试证明无关 commit 不改 Pilot tree、但独立支持 tree 改变；复制/移动目录保持内容 tree、改变身份，不按 tree 合并目标。 |
| 同 repo 多 Pilot、多来源版本、跨 repo | pilot-source 的 same-repository 测试同时绑定新 root 与旧 commit 的另一目录，拒绝伪造版本；cross-process dependency 测试通过完整来源表重取已更新外部仓库的旧快照并检查路由/清理。 |
| 本进程与 process 的成功、未达标、调用失败 | objective-pilot 的 pilot/dependency/probes 测试覆盖聚合、同次版本合并、跨进程 IPC、调用错误与依赖问题区分；生产 Git 证据包括 tree、commit 和独立支持 tree，错误不伪装成正常未达标。 |
| 来源更新、依赖更新、迟到结果 | pilot-source 的 cross-process 测试证明原绑定固定而新绑定跟随；portfolio 的 controlled binding replacement 测试覆盖有 live consumer 的版本替换、重新观察、revision 更新、迟到 provider 结果隔离；已有 Behavior 变更与旧 completion 测试继续通过。 |
| 取消、释放、更新失败 | git-source 的 scoped 取消/关闭、process probe 清理测试，以及 pilot-source 的 preparation deadline、primary/cleanup 双错误测试；Supervisor 将刷新错误投影为失败并中止，不隐瞒来源失败。 |
| 重启、continue、历史状态 | objectives 的 declaration-mutation 测试证明同名声明被替换后 continue 仍用原绑定；cross-repository continue 测试实际更新 child 仓库，恢复仍取原 commit，而新运行跟随新来源；regulator-cli 的 legacy continue 与 unpublished origin 测试覆盖旧记录拒绝和本地原快照恢复。 |
| 两类作用域、Unit/参数化、两层 schema | objectives 测试覆盖用户 Unit/目录参数化及反向组合、scalar/array/null、非空 Unit、普通可选对象、输入与投影错误、同名消歧、exact-directory 无继承、两个 checkout、无包清单目录、发现不求值/远程解析。 |
| 仓库四个 Pilot、验证脚本、公共文档 | 四个 objective 实例的直接 loader/URI、内置 sanity fixture、内部问题 envelope 均更新；生成 setup/health runtime；发布包 bin 清单接线 objectives；monorepo/deployment/health/docker 脚本使用目录 ID 与 tree/commit 独立断言。未改历史 Idea。 |

## 可重放验证

从仓库根目录执行：

```powershell
pnpm exec tsc -b --pretty false
pnpm exec tsc -p tsconfig.test.json --pretty false
pnpm exec tsx --test --test-concurrency=1 packages\objective-pilot\test\identity.test.ts packages\pguide\test\objectives.test.ts packages\pguide\test\pilot-source.test.ts
pnpm exec tsx --test --test-concurrency=1 packages\objective-portfolio-supervisor\test\objective-portfolio-supervisor.test.ts packages\pguide\test\supervisor-cli.test.ts
pnpm check
```

测试只使用可清理的本地 fixture 与假的 ACP/HTTP 服务。`runTests` 工具未发现 Node/tsx 测试，故使用项目既有 runner；未安装新依赖。最终完整输出保存在同目录 `Verification.log`，只标准化换行及三个 Turbo 耗时行的尾空格，包含格式、lint、两层类型检查、全部测试及 pack:check。

最终结果：Windows、Node.js 24.12、pnpm 11.22；`pnpm check` exit 0。全部 runner 合计 441 tests，439 pass、0 fail、2 skip；跳过项是既有文件 symlink 权限与平台大小写场景，不是将失败标成通过。12 个 workspace 的 lint/typecheck/build 及 24 个 build/test 任务成功，32 个脚本测试通过，八个发布包的 pack:check 全部通过；pguide 包含新增 objectives 命令（79 个打包文件）。编辑器对关键实现文件亦报告无错误。

开发期间的定向日志位于仓库 `.cache\directory-objectives-*.log`，不作为必须恢复的生产状态；最终持久证据以本文件、同目录完整日志和已同步的源码/测试为准。部署尚未执行，D-* ledger 保持未完成。
