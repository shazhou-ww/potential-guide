# CLI 输出改造使用说明

## 直接阅读结果

普通 pguide 命令不加显示选项时面向人类阅读，显式 `--format markdown` 使用同一规则：

```text
pguide objectives list
pguide objectives show sample --scope directory
pguide agents list
pguide diagnose agent local
```

列表显示查找范围、名称、来源及清晰空态；详情按需要展开配置。观察、调节和监督会区分当前状态、停止原因和下一步。诊断初始化成功并不等于已经验证认证或真实修复能力。

## 脚本显式选择 JSON

```text
pguide objectives list --format json
pguide probe --pilot <source> --subject-file <subject.json> --format json
pguide config edit --scope project --format json
```

JSON 结果可独立解析。配置编辑成功现在会返回保存结果，编辑器自有输出在 JSON 模式走 stderr。普通命令既有结果/错误 envelope 继续位于 stdout，退出码和各领域 schemaVersion 保持兼容；不要把所有领域强行按同一种顶层结构解析。

不应依赖人类摘要作为稳定机器接口。观察成功不等于 Objective 已完成，监督周期结束也不等于所有目标已达成；请检查 JSON 中相应的业务状态。

## 迁移器的两个格式维度

```text
objective-contract-migrate --format manifest --input legacy.yaml --output objective.json --output-format json
```

- `--format manifest|declarations|portfolio`：选择迁移文档种类，含义不变。
- `--output-format markdown|json`：选择命令回执的显示格式，不控制产物内容。
- 输出文件扩展名继续决定产物为 JSON 还是 YAML。
- 输入保持不变，既有输出不会被覆盖，pinned commit/tree 证据不会被重新绑定。
- 旧 `--help --format json` 仍保留为帮助兼容入口，不应推广成实际迁移的文档种类。

## 原文和协议例外

- `config get` 保留标量原值或对象内容，不附加人类标题。
- `complete` 默认仍输出可消费的 shell 补全脚本。
- `--pguide-command-metadata`、Objective check/runtime envelope 和报告文件保留原协议，不添加展示标题。
- 默认迁移错误继续写 stderr；不要把它与普通 pguide JSON 错误 envelope 的 stdout 边界混淆。

## 有意修正与验证限制

`pguide validate pilot <path> --bogus` 现在明确报错并退出 2，不再忽略未知参数后报告成功。

本次验证以同步到 primary 的候选包、隔离消费者和合成输入为对象；不是 npm 发布授权，也不是交互 TTY、屏幕阅读器、POSIX、真实认证/修复或远程健康检查证明。完整仓库仍有改造前已复现的 Supervisor 能力反馈超时用例；不能把本次输出专项通过写成全库全绿。
