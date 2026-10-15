# Deployment

## Steps

### D-S01: 从使用方验证主分支候选版本

通过使用方层面的 guide，采用独立 checks 与不同调度限制，
验证主分支上已验收的实现。使用 [使用方验证脚本](./verify-consumer.mjs)
直接导入三个包的构建产物，比较并行度为一与二时的观测、峰值并发、阶段屏障
和 regulator 修复后的结果。

本次明确不发布 npm 包、不创建版本标签或 GitHub Release，也不进行生产环境上线。
所有包的发版暂缓，待基于已有 git-lineage 完成 preset 继承后，
再采用继承的发版方式发布；本次不实现 preset 继承或另建临时发版流程。
该发布约束不阻塞此次主分支使用方验证。

## Acceptance criteria

### D-AC01: 主分支提供已验收的阶段行为

针对已验收的主分支版本，进行可复现的使用方验证，证明串行和并行调度产生相同的
阶段与问题结果，且当前阶段失败时仍会阻塞后续阶段。
在部署阶段将主分支版本和验证证据记录到本契约。

2026-10-15 使用方验证基线为主分支提交
`bb6a02b928eff35f1376ceca0dbb54f1bb489c27`，
已验收的实现修订为 `f5a1e62c5520a7bfb3919e77ac913b8dc566ee9b`。
执行 `npm run build` 后运行
`node .silvermoon\ideas\01M4YFKY994V03JRDGJZCBVJJM\outer\verify-consumer.mjs`，
构建与全部脚本断言通过：

- 并行度一和二的当前阶段均为 `stage`，问题按 `first`、`second` 排列，
  `gapSummary` 相同；实际峰值并发分别为一和二。
- 当前阶段失败时 `later` check 执行次数为零；
  经真实 supervisor、regulator 修复并重新观测后均到达 `terminal`，
  `later` check 各执行一次。
- 脚本报告 `publication: "not-performed"`；没有执行发布命令，
  没有创建版本标签或 GitHub Release。

同日发布状态观测：`git tag --list` 和 `gh release list` 均未发现发布记录。
浏览器访问以下 npmx 公开包页面均显示 `404 — Package Not Found`：
[objective-guide](https://npmx.dev/package/@potential-guide/objective-guide)、
[objective-regulator](https://npmx.dev/package/@potential-guide/objective-regulator)、
[objective-portfolio-supervisor](https://npmx.dev/package/@potential-guide/objective-portfolio-supervisor)。
这是公开页面旁证，不等同于对历史发布或私有 registry 的完整证明。
公司限制访问 npm registry，直接查询发生 TLS 错误；未使用代理或镜像绕过该限制。
