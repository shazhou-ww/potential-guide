# 候选包交付验证

## 对应契约与来源

- 先同步的部署契约：`deploymentRevision=af58d6e2f253`。
- 打包和安装所用源码：[primary 5af38b4d2f06](https://github.com/shazhou-ww/potential-guide/tree/5af38b4d2f069933b81a039b73b79d4378de7f6d)。
- 已验收的实现：`implementationRevision=20a93ba0e6ef`；本阶段未修改 Inner/Ideal 世界或仓库实现。
- 环境：Windows，Node v24.11.1；所有消费者和合成 subject 位于工作树之外的独立目录。
- 使用实际 pnpm 安装产生的主入口与独立命令 shim，不把 workspace 源码或全局 pguide 作为被测应用。
- 结果是候选包验证与使用说明交付，不是 npm 发布；没有运行真实 Agent、主机健康检查或远程修复。

## 隔离消费者与业务结果

17 个公开包候选分别打包并校验依赖图；protocol、main、pilot、regulation、supervision、coordinator、objectives、config、agents、combined 共 10 个隔离消费者全部通过。coordinator 是并发 primary 已有的公开包，消费验证不将它归为本 idea 新增功能。

额外验证 35 条真实 CLI 捕获，以及 13 个私有 Objective 协议包装器。最后一轮补充验证共 61 个子进程调用，包含预期错误；不将它们描述为所有退出码均为 0。

| 场景 | 观察与证明 |
| --- | --- |
| 空态、单条与多行描述 | 安装后的 Objectives/Agents 结果可读；默认与显式 Markdown 相等；特殊字符被转义，JSON 保留声明值。 |
| 主入口与独立命令 | Objectives list/show、probe 等对照的实际 stdout 相等；combined 分派与全部独立命令的结构化帮助通过。 |
| 配置和编辑 | show 有来源；get 仍是原值；edit 返回独立 JSON，合成编辑器诊断只出现在 stderr。 |
| 观察与调节/继续 | 本地已提交 Git Pilot 得到 terminal 观察；regulate/continue 保留 target-reached 及 schemaVersion 2；不执行真实修复。 |
| 监督 | 本地 ACP planner 生成 1 条未完成 demand；500 ms 周期结束后明确写出未达标、资源为 0 和待处理原因，JSON 保留 schemaVersion 3。 |
| 输入与错误 | 未知 Objective 明确不存在；validate --bogus 返回 invalid/error、退出 2，不再产生成功回执。 |
| 迁移器 | 安装后的独立迁移 bin 支持 --output-format json；产物可读、输入逐字不变，重复输出路径明确拒绝。 |
| 原文出口 | PowerShell 补全仍为可执行原文，等于 JSON.script；命令元数据仍为 pguide-command-v1。 |
| 固定协议 | 四个私有本地 tarball 仅作 fixture 安装；health 5、setup 3、self-check 3、monorepo 2 个包装器接收非法 JSON，返回原 envelope。前三类 status 400，monorepo 502，均无展示标题。 |

## 验证器修正与保留边界

首次额外冒烟暴露的是隔离工具链只有 node.cmd，原生 check 子进程找不到 node.exe。修正 fixture 为真实 Node 可执行文件后，所有业务场景重跑通过；应用实现未更改。

随后发现公开发布清单有意不包含四个 private Objective，验证器错误地将它们当作公开 tarball 查找。改为分别本地打包这四个私有 fixture，重新验证 35 条 CLI 捕获及 13 个协议包装器后通过。十个公开消费者的既有成功结果由实际日志保留；复用前重新检查了 tarball SHA-256 与源码 tree，没有把前两次验证器失败写成成功。

完整仓库的既有 Supervisor 能力反馈超时仍按[实现验证](./inner/Output-validation.md)披露。本次没有跳过、改写或宣称修复该测试。TTY、屏幕阅读器、POSIX、真实认证及 npm 分发不在本次已证明范围内。

## 使用说明交付

同一 primary 已同步[使用说明](./Usage.md)：区分默认 Markdown、普通 CLI 的 --format json、迁移器的文档种类与回执选项、原文/固定协议例外、未知 validate 选项的有意行为修正，以及验证限制。

## 候选包内容摘要

以下 SHA-256 对应实际安装的本地 tarball。私有 fixture 不是 npm 发布清单。

| 包 | 版本 | 用途 | SHA-256 |
| --- | --- | --- | --- |
| @potential-guide/effects | 0.1.0-rc.0 | 公开包候选 | `0fe03517fa0d74ee2e6f6d45fa1b9716fd3de939c80654ed3283478b5b6c7c00` |
| @potential-guide/git-source | 0.1.0-rc.0 | 公开包候选 | `3a4a742d893fda8b32e35b95c9a5b7784450243ad79155437c455f0bf7d7f813` |
| @potential-guide/objective-pilot | 0.2.0-rc.0 | 公开包候选 | `1533bb3dbe1b1bcdda6677aa56aae0e670ba4ac9bd075c754a50deab7224b55f` |
| @potential-guide/objective-regulator | 0.4.0-rc.0 | 公开包候选 | `1c21e6c12639e61920cc0883abb0a5378b31df17e37e64a958ce819e2b4b96a8` |
| @potential-guide/objective-portfolio-supervisor | 0.4.0-rc.0 | 公开包候选 | `ad580dde6e798d4cd68601e9274060c3f11c7e7de2d3e853f1dc94a3ed4c1c36` |
| @potential-guide/regulation-coordinator | 0.1.0-rc.0 | 公开包候选 | `0599884a7cacbd0e4a10fee528edd4c63a9fbb3dcb8b1849b819a2f279e2c820` |
| @potential-guide/cli-core | 0.3.0-rc.0 | 公开包候选 | `061aa30eb7fe0ab5a67efdcc118bd92cfce47572b0283e1f0d41da16330efe75` |
| @potential-guide/pguide-config | 0.3.0-rc.0 | 公开包候选 | `8e224c905ad4b63dc8b87615d7fa2cb4859f2d0c0e1c06693903cc2707d1ca97` |
| @potential-guide/pguide-agents | 0.1.0 | 公开包候选 | `6df90bf32f34d6974a0644edf5a540f1a561c53727508a10c7b969d7f6c40986` |
| pguide | 0.4.0-rc.0 | 公开包候选 | `c32b81f632c6af4daeb0ce5a6e896a62374dd026d36bceee48fe441077b9c98a` |
| @potential-guide/pilot-protocol | 0.1.0-rc.0 | 公开包候选 | `9e82cac5b1129ec717385541145b3290c0aecdbf08a888574359660721ba4247` |
| @potential-guide/cli-runtime | 0.1.0-rc.0 | 公开包候选 | `f0d09d07ef52178a82b95d887a5d9796347fec59550dd2a802220b3fef7f4da6` |
| @potential-guide/objective-declarations | 0.1.0-rc.0 | 公开包候选 | `253caf83e4ac091fb0045f19957de8eba5a9b6f3155ca94172b496129e43ef60` |
| @potential-guide/pguide-pilot | 0.4.0-rc.0 | 公开包候选 | `3e4c7c6dad20a573e65a752bc298c616811bcb66bbd2ab5d9fb321e8f1b8f44d` |
| @potential-guide/pguide-regulate | 0.4.0-rc.0 | 公开包候选 | `94f5f458f387cc685148e6a577b193d1ddad369797a946e1f1cf8f3b753d52af` |
| @potential-guide/pguide-supervise | 0.4.0-rc.0 | 公开包候选 | `fc796d75cd1318c361f5f9610b63052db0f3f28d6f75722db32f7858e7a8c86d` |
| @potential-guide/pguide-objectives | 0.4.0-rc.0 | 公开包候选 | `cafcd3518c7aa78c0af6a0119cf3ef9c920b79814ebcf1138878cc831ce2e7d2` |
| @potential-guide/objective-devbox-health | 0.1.0 | 私有协议 fixture | `d683422b99d9206253088841722fccff54cebce2be14ff006380764b9f9001a2` |
| @potential-guide/objective-pguide-setup | 0.1.0 | 私有协议 fixture | `4b2076f188510fad45c34418722b1f81baf5ec3b95e643f633f94a082b2a42b5` |
| @potential-guide/objective-pguide-self-check | 0.1.0 | 私有协议 fixture | `83d75d54d61fa318df8928b6e0d601f839533c5af95cb25d33a6d8044831ba58` |
| @potential-guide/objective-monorepo-standard | 0.1.0 | 私有协议 fixture | `7c8556b435e414c48ba4321ab44c18fbf6d52dd2d54765e594e8e59c2e7903ab` |

## 安装后实际输出

以下是实际 stdout，`<CANDIDATE>` 仅替换隔离目录，`<UUID>` 归一化随机标识；长样例明确截取。普通命令另带隔离 --cwd/--config，不读取真实用户资源。

### objectives-list-default

命令：`pguide objectives list --scope directory`；退出 0。

````text
# Objectives

- Scope: directory
- Context: `<CANDIDATE>\subject`

## `sample`

- Description: Installed \*\*sample\*\* \| multi line

- Scope: directory
- Source: `<CANDIDATE>\subject\objectives.yaml`
````

### config-edit-json

命令：`pguide-config edit --scope explicit --format json`；退出 0。

````text
{
  "schemaVersion": 1,
  "status": "updated",
  "path": "<CANDIDATE>\\smoke-config.json"
}
````

### probe-default

命令：`pguide probe --pilot git+file:///<CANDIDATE>/subject#objective/ --subject-file <CANDIDATE>\subject.json --no-reports`；退出 0。

````text
# Observation

- Objective: `git+file:///<CANDIDATE>/subject#objective/`
- Status: complete - terminal reached.
- Current level: `terminal`
- Problems: 0

## References

- Reference: `levels/terminal`; language: `en-US`.

- Next action: no repair is needed for this observation.
````

### supervise-execute

命令：`pguide-supervise --portfolio-file <CANDIDATE>\portfolio.json --planner fixture --execute --duration-ms 500`；退出 0。

````text
# Portfolio supervision

- Mode: execution.
- Status: supervision cycle ended.
- Goals: 1 goal.
- Remaining demands: 1 demand.
- Resources: 0 resources; total capacity 0.
- Termination boundary: duration limit reached (500 ms); active work was stopped.
- Completion: a completed cycle or empty queue does not prove all goals are reached; see the latest observations below.

## Goals

- Goal: `pending`; Objective: `git+file:///<CANDIDATE>/subject#gap/`; target: `terminal`; current: `initial`; status: target not reached.

## Remaining demands

- Demand: `pending`; target: `terminal`; requirements: none; pending reason: no resource matches the required capabilities.

- Next action: review unmet goals and stop conditions, adjust resources or permissions if needed, then rerun supervision to obtain fresh observations.
````

### validate-invalid-json

命令：`pguide-validate pilot <CANDIDATE>\subject\objective --bogus --format json`；退出 2。

````text
{
  "schemaVersion": 1,
  "status": "invalid",
  "error": "Unknown option: --bogus."
}
````

### complete-raw

命令：`pguide complete --shell powershell`；退出 0。

````text
Register-ArgumentCompleter -Native -CommandName pguide -ScriptBlock { param($wordToComplete) 'probe','regulate','continue','supervise','scaffold','validate','config','agents','objectives','diagnose','complete' | Where-Object { $_ -like "$wordToComplete*" } }
````

### metadata

命令：`pguide-objectives --pguide-command-metadata`；退出 0。

````text
{"protocol":"pguide-command-v1","command":"objectives","description":"Discover and manage user and directory Objective declarations","version":"0.4.0-rc.0"}
````
