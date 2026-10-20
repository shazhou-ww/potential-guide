# 实施验证与边界

## 验证环境

在隔离的 `objective-worktree`、`schema/objective-normalization` 分支完成；
起点为已接受三个 Ideal 的 `0b53a32547555240897328282e68aad305287ed6`。
运行环境为 Windows、Node.js 24.12.0、pnpm 11.22.0。
未修改原始工作目录。首次完整检查通过后，primary 已推进，旧 Agent 事件历史
导致 Silvermoon 正确拒绝 stale candidate。为保留 append-only 历史，按授权保存
自身候选并 fast-forward 到 `f82cbd8f7287f1268102b963b1241a55c05c05ff`，
恢复候选并解决 allowedDirectories/包数量两处冲突，再完整验证。
Agent 实现与生命周期记录仅随 primary 集成，没有自行修改或新增事件。

## 可复核结果

- `pnpm check`：最终退出 0。包含层次检查、格式、lint、类型检查、
  schema/独立 runtime 生成一致性、workspace 测试、根脚本测试及 tarball 消费。
  集成后最终 lint 为 20 个任务中 11 个缓存命中；typecheck 为 20 个任务中 7 个缓存命中；
  workspace test/build 共 40 个任务成功，其中 27 个缓存命中、13 个实际执行。
  未把缓存重放当作全部重新执行。
- 最终日志中 protocol 为 9/9、monorepo 为 43/43；pguide 为 87 项，
  85 通过、2 个平台跳过、0 失败。pguide 集成验证实际执行约 280 秒。
  根脚本测试为 39/39。
- `pnpm pack:check` 独立执行通过；最终 `pnpm check` 也再次执行并通过。
  集成后 16 个公开包、9 个隔离 tarball 场景全部通过；protocol 场景不安装执行角色包。
  直接解析包内 JSON schema、比对嵌入定义、离线校验，并实际执行安装后迁移 CLI，
  验证源文件未修改且再次写同一输出明确 `EEXIST`。
- `node --test scripts\pilot-packages.test.mjs scripts\publish-schemas.test.mjs`：
  5/5，通过私有独立 runtime 打包、离线运行和不可变发布反例。
- `silvermoon check --worktree --audience agent`：通过。
  提交前还要求 staged snapshot 通过；不把本地 snapshot 检查当作同步或门控事件。

## 关键实现选择

- 只有静态入口、manifest、声明及数据引用改名。`RegulationRuntime.pilot`、
  Pilot 执行模式与既有命令名称保留。报告与恢复的无关数字版本不变；
  Portfolio 仅在本轮范围内改目标引用。
- 公共 schema 从仓库 `schemas/` 生成协议包字节一致副本及嵌入定义；
  本分支仅拥有 objective/objectives。发布收集和不可变测试自动覆盖其他格式，
  已在集成后的 agents/v1.json 上验证；不要求未集成的其他格式先存在。
- 文档校验延迟编译，避免所有 probe 子进程在纯导入时付出 schema 编译成本。
  输入 schema 编译使用最多 128 项、按内容索引的缓存，编译前分离调用方对象；
  测试防止后续修改污染缓存，异步 Ajv schema 明确拒绝。
- 实际跨进程依赖、Agent capability 反馈、重新观察及 continue 都经过集成测试。
  带额外 schema 校验的复合 Windows 场景暴露了原 fixture 8 秒窗口的临界失败；
  该测试的反馈窗口改为 15 秒、对应 Agent 限额 20 秒，仍显式有界并等待真实反馈，
  不修改生产超时策略、不跳过断言。

## 迁移不是来源替换

`objective-contract-migrate --format manifest|declarations|portfolio --input <旧文件>
--output <不存在的新文件>` 是独立工具，不占用 `pguide-*` 扩展发现命名空间。
源和已有目标永不覆盖；声明转换基于 AST，字符串常量不替换；
无法保留语义的 context/opaque 身份要求显式审阅的 subject override。

非固定版本 Portfolio 可转换；固定 commit 的 Portfolio、旧 recovery/report/queue
不能靠改字段产生指向新 manifest 的真实 tree。工具明确拒绝这些不支持的输入，
原证据保留，迁移并提交目标后应显式新建绑定/观察，不伪造或静默升级 commit/tree。
新格式的跨进程固定来源和 continue 恢复路径已有通过证据。

## 不属于本次实施证明

没有 npm 发布、push、submit/accept 事件或公共 Pages 部署。
Pages workflow 的路径、内容不可变/删除/不可用保护通过本地测试；
真实公共获取、包外哈希一致性及 POSIX 独立消费属于 Deployment。
并发 Agent 分支已集成并再次完整检查。父协调者仍需重点复核 CLI profile 消费
隔离性、root objectives/package 声明和 monorepo 包数量；新增 Agent workspace 的
声明也已转换为当前 Objective 契约，未改变 Agent 资源加载语义。
