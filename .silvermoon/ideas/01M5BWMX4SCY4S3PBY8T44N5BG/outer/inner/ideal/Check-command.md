# 独立 expected-level check 命令与 probe 转换

本文服务于 [Idea](./Idea.md)，补充 [依赖模型](./Dependency-design.md) 和 [Haskell 对照](./Protocol-before-after.md)。以下是待实现的命令协议，不是现有命令或实现完成声明。

## 1. 职责分层

```text
受控来源解析 + Pilot.observe
  → check 命令：current 是否达到 expected，得到 true / false
  → 依赖 probe：true 转通过，false 转 DependencyProblem
  → 当前 Objective 的 observation 聚合问题
  → Regulator 正常交接
  → Supervisor 统一调度
```

check 命令不是 Regulator，不执行 Agent、不改变目标状态、不产生 problem，也不调度其他目标。布尔值只表示达到预期层级与否；观察本身失败是错误，不是 false。

依赖判断独立可复用，且与 problem 构造解耦。不需要新的 Manifest dependency 节点，不恢复静态 prerequisite 配置。

## 2. 命令接口

建议新增顶层 `pguide check`，与已有 `pguide probe` 区分：

```powershell
pguide check --pilot environment --expected-level ready --subject-file .\environment.json --report .\level-check.json
```

| 参数/输出 | 约束 |
| --- | --- |
| --pilot | 必填，复用既有 Objective 别名或 Git manifest URI 解析；报告中写解析后的规范化 ID |
| --expected-level | 必填，目标 manifest 中存在的层级或 terminal，无默认值 |
| --subject-file | 复用现有 subject 读取和 schema 校验；未指定时沿用既有 stdin 读取约定 |
| --revision | 可选，复用既有来源版本选择；观察实际使用的精确提交必须记录在 report |
| --report | 独立使用可选；依赖 probe 调用时必填，由 probe 分配私有临时路径 |
| stdout | 成功完成判断时恰好一行 JSON 布尔值 true 或 false，无标题、日志或 envelope |
| stderr | 诊断信息；失败时明确报错，不输出成功形态的布尔值 |

布尔 stdout 是命令固定的机器契约，不随全局人类输出格式变成 Markdown。帮助参数仍按现有 CLI 处理；不能把帮助输出当成一次检查结果。

已有 probe 命令继续返回完整 observation envelope，不改名为 check，也不改成布尔输出。check 复用底层 observe，而不是抓取 probe 的人类文本。

### 退出码

- 0：判断已完成，stdout 可以是 true，也可以是 false。
- 2：参数、配置、目标层级或输入无效。
- 6：已解析请求的观察调用失败，包括来源/协议/探针故障及必要报告写出失败；取消沿用 CLI 的信号约定，不伪造布尔结果。

沿用业务未通过不等于调用失败的原则。调用方必须解析布尔值，不能将命令退出 0 当作目标已达标，也不能使用 shell 的 `if command` 代替布尔判断。低层错误若被现有 CLI 识别为输入错误，仍保留其显式分类。

## 3. 一次观察与证据报告

裸 false 无法恢复当前层级或来源版本。因此业务结果是布尔值，但需保留同次观察的结构化证据；不在 false 后再观察一次，不把第二次状态拼到第一次判定上。

report 目标结构示例：

```json
{
  "passed": false,
  "objectiveId": "git+https://example.org/objectives.git#environment/pilot.yaml",
  "subject": {"environment": "staging"},
  "expectedLevelId": "ready",
  "currentLevelId": "provisioning",
  "observedAt": "2026-10-20T05:55:00.000Z",
  "versions": {
    "git+https://example.org/objectives.git#environment/pilot.yaml": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
```

report 不包含 problem、ProblemRef、Agent binding 或完整 PilotSpec。passed 必须等于 stdout 的布尔值及本次层级比较结果。层级比较按固定目标规范的顺序，不按名称字符串排序。

执行顺序：校验请求、解析固定规范、观察一次、校验观察归属/证据、计算 passed、成功原子写出所需 report，最后输出布尔值。不能先打印 false，之后才发现报告无法写出。

probe 为每次调用分配新路径，不复用历史 report。它核对 stdout 格式、退出状态、报告完整性、目标、subject、阈值、来源版本与 passed 的一致性；任一不一致即调用错误。

## 4. Probe 的结果转换

| check 结果 | 依赖 probe 输出 |
| --- | --- |
| true，证据有效 | status 200，payload 为 ok: true、problems: [] |
| false，证据有效 | status 200，payload 为 ok: false、包含统一依赖 problem |
| 调用失败、超时、无效 stdout/report | 非成功 envelope，payload: null；取消按原生取消传播 |

false 转换后的业务 payload：

```json
{
  "ok": false,
  "problems": [{
    "kind": "dependency",
    "objectiveId": "git+https://example.org/objectives.git#environment/pilot.yaml",
    "subject": {"environment": "staging"},
    "expectedLevelId": "ready",
    "currentLevelId": "provisioning"
  }]
}
```

版本证据不塞进 problem 参数：专用适配层把 report 的版本贡献并入当前观察上下文的 versions，冲突明确失败。true 也应贡献其已读取的版本，不能只记录失败依赖。

现有 createProcessCheckProbe 要求 stdout 已经是 Envelope<CheckResult>，不能直接拿它执行裸布尔命令。增加专用依赖 probe，复用或抽取既有进程执行、取消、预算和清理逻辑，在进入统一 envelope 校验之前完成转换；通用 probe 不猜测任意 false 的含义。

若用检查脚本包装命令，该脚本承担依赖 probe 的角色：消费布尔值与 report，再输出统一 envelope；其版本证据仍须经显式适配回传，不能扫描任意临时文件或仅信任一段 dependency JSON。

## 5. 在 level 中复用与拆分

一次命令只判断一个 Objective 实例达到一个 expected level：

```text
level: publish
  check: environment-ready
    probe → pguide check(environment, staging, ready)
  check: artifact-ready
    probe → pguide check(artifact, release-X, verified)
```

也允许一个组合 probe 调用若干次相同命令，聚合全部 false 对应的依赖问题。拆成多个 check 时，每个 probe 独立返回，Pilot 聚合同层结果。两种组织方式必须得到相同的未满足依赖集合，不因只取第一个 false 而漏掉其余已知依赖。

一个目标的多项条件若已有独立 Objective，分别检查各自目标；若条件位于同一 Objective 的不同层级，则调用相应 expected level。这里不新增「任意跳过外部 Objective 某个层级 check」的能力。

不默认把依赖 check 提前为整个 Objective 的启动门槛，也不默认先执行依赖、跳过同层其余 check。若检查本身存在安全执行门控，另行明确，不混同治理等待。

## 6. 验证要求

- current 等于或高于 expected 返回 true，低于返回 false；显式 terminal 和非字典序层级正确。
- true/false 均退出 0；错误不输出布尔值，不被转换成 dependency。
- standalone 不生成 problem；probe 是唯一业务转换点。
- report 来自一次观察，stdout/report 一致；报告缺失、过期路径复用、写入失败及错目标明确报错。
- 一个组合 check 与多个拆分 check 聚合结果一致；同层混合内部问题仍按既定交接规则执行。
- command/report/probe 贯通版本、总预算、调用栈、取消与清理，原生进程 probe 的既有 envelope 契约保持不变。

这仍是设计补充。当前工程和 Silvermoon 工程既有 Objective 定义之后手动迁移，不由本轮自动改写。
