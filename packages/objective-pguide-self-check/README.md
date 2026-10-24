# pguide 本机自查

本 Objective 是独立 npm 包；runtime 从 setup、既有 ACP
与权限源码生成。`pnpm build` 输出忽略的 staging/dist；
消费 `dist/package` 或准确 tarball，按实际包名/完整内容 digest 固定，
不再提交生成副本。`pnpm self-check:check` 验证新鲜度。
职责与历史 URI 迁移见 [Pilot packages](../../docs/pilot-packages.md)。

独立、只观测的本机 Objective，由被检查设备上**已安装的 pguide** 运行；
没有新增 CLI 命令。缺 pguide 时先用 [setup/bootstrap](../objective-pguide-setup/README.md)
补齐安装。旧 setup（含 SSH、`allowSanity` 和 regulation fixture）保持原行为。
Agent profile 由被检查设备的 `pguide agents show` 从用户/项目 `agents.yaml`
读取，主配置只保留默认名称等设置；新 subject 拒绝 `configPath`。
旧内嵌 profiles 必须先显式执行 `pguide agents migrate --scope user|project`。
后续远程整备应以 B 的 pguide 运行本自查达到 terminal 为依据，不能用 A 的结果替代。

## 输入与运行

subject 示例（路径必须属于当前设备和用户，且均为绝对路径）：

```json
{
  "workingDirectory": "D:\\self-check",
  "scratchDirectory": "D:\\self-check\\scratch",
  "pguide": {"command": "pguide"},
  "agent": "existing-acp",
  "timeoutMs": 20000
}
```

Windows 也可将 pguide 指定为 Node + 已安装的绝对 JS 入口：
`{"command":"C:\\Program Files\\nodejs\\node.exe","args":["D:\\installed\\pguide\\dist\\bin.js"]}`。
可选 `desiredVersion` 精确匹配版本；可选 `userHome` 仅指定本机现有 HOME，
不复制认证，也不覆盖 APPDATA/XDG 配置根优先级。有效配置按 pguide 的用户→最近项目
两级规则在 workingDirectory 发现，至少须有一份实际 `config.jsonc`；
均缺失报 configuration-missing，默认设置不能代替文件。不要指向非预期项目 override，
不要在 subject 中放凭据。旧声明只定点移除 configPath 投影及真正依赖它的输入约束，
不重建资源或改历史 pin；见[手工迁移](../../docs/package-settings.md#setupself-check-declarations)。
`target`（包括 local/SSH）及 `allowSanity` 均不是本自查输入，提供时拒绝。

用已安装的 pguide 与提交过的 Git 子目录快照运行（将 URI、revision、subject 替换为实际值）：

```powershell
pguide probe --pilot "git+file:///D:/Code/potential-guide#packages/objective-pguide-self-check/" --revision <commit> --subject-file D:\self-check\subject.json --cwd D:\self-check --format json
```

这条 probe 会执行一次 sanity；不要紧接着为“确认”重复运行，避免额外模型调用。
也可在已授权的 regulation 中使用同一 Pilot；自查内部不会再次 regulate。
直接诊断入口为 `node packages\objective-pguide-self-check\self-check.mjs <installation|configuration|sanity> --subject-file D:\self-check\subject.json`。
单独运行 helper 成功**不等于**完整 Pilot terminal，更不等于真实设备验收通过。

## 分级与边界

`initial → installed → configured → verified`，initial 是协议内置基线；
每个业务 level 的一个 check 是累计达成该层的条件，terminal 仅为 verified 的目标别名：

- installation：指定安装的结构化身份/版本及可选 desiredVersion。
- configuration：复核安装、配置、config/probe/regulate 发现和所选 ACP stdio
  profile；真实 initialize + session/new，不 prompt。AHP 明确不支持。
- sanity：复核依赖、ACP readiness，在独占 scratch/task 下创建错误的 marker.txt，
  **一次** AcpClient.prompt，要求只改 marker.txt，然后独立核验普通非链接文件、
  单硬链接、大小和随机精确内容（允许无行尾或一个末尾 LF/CRLF，兼容文件编辑工具）。
  仅摘要、错误内容、多余换行、拒绝权限都不通过。
  readiness 由同一个修复 Agent 的 initialize、必需能力及 session/new 核验，
  不先启动另一个探测 Agent；configuration 仍独立建立无 prompt 的会话。
  修复会话启动失败返回 acp-unavailable 及安全 stage/startup-failed 分类，
  不输出原始服务端错误。

执行 self-check 已包含一次低损耗 sanity，不另加 allowSanity 检查级授权。
sanity 是自动执行的小型安装验收，不使用修复任务的 `regulate.permissions` grants，
也不要求人工逐次确认。仅此独占任务的 ACP 会话自动选择 Agent 提供的 `allow_once`；
不选择 `allow_always`，不修改用户配置或正常 regulate 的权限策略。
沿用 profile 原有参数及 Agent 自身限制，不自动添加 CLI 的 allow-all。
不支持的客户端请求、缺少单次授权选项或 Agent 自身拒绝仍失败，即使 marker 碰巧已正确。
模型不可用、额度不足不重试。
Agent 要求认证时，先由当前用户通过 Agent 的正常登录流程恢复认证
（例如 Copilot 的 `copilot login`），正常登录后再运行一次自查；
不复制凭据、不扩大权限，不在外部条件未变时自动重试。
不承诺免费。小任务不要求 Git、网络、安装或提交；Git 仅为外层加载 Objective
快照所需。隔离 cwd 不是恶意全权限 Agent 的安全沙箱。

每个 check 默认总预算仍为 20 秒，外层 probe 默认仍为 **30 秒**。
Pilot 要求 `subject.timeoutMs + 6000 <= pilot.probe` 的 `timeoutMs`，
为启动、响应输出及进程树/scratch 清理留余量；因此默认外层期限下仍最多 24 秒。
`timeoutMs` 可显式指定 100–300000 ms，预算包含命令发现、ACP readiness、
一次 prompt 和清理，不会自动延长外层期限或重试。

真实 Agent 启动和任务执行较慢时，可显式将 subject 的 `timeoutMs` 设为 `60000`，
同时在本次 `--cwd` 发现的用户/项目 `config.jsonc` 中协调外层期限，例如：

```jsonc
{
  "pilot.probe": {
    "timeoutMs": 90000,
    "retry": { "maxRetries": 0, "delayMs": 0 }
  }
}
```

只增加 subject 预算而不增加外层期限会在执行前报 `outer-timeout`，不是等待后超时。
外层运行器通过 `PGUIDE_PROBE_TIMEOUT_MS` 注入实际期限；缺失时按 30000 ms
处理，格式非法时拒绝执行。不要通过手动覆盖该内部元数据冒充已协调的 probe。
直接 helper 可显式使用最多 300 秒，但只有使用协调期限的完整 probe 达到
terminal 才是通过证据，不能以长 helper 或独立 Agent baseline 替代。
Agent 原始 stdout+stderr 上限 192 KiB，外围进程 stdout+stderr 上限 256 KiB。
`regulate.agentTimeoutMs` 若更短仍生效，不放宽用户执行期限；迁移时保留旧显式值。
超时/输出超限终止受管进程树；无重试，只删除本次 mkdtemp 独占目录及其状态，
不删除 scratch 根目录或其他任务。POSIX 需 ps。Windows 需 PATH 中可用的
`taskkill`（按受管 PID 执行 `/PID <pid> /T /F`），以及系统
`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`。ACP 清理通过
`-NoProfile -NonInteractive -Command` 运行固定脚本，需允许 `Add-Type` 在内存中编译
C# P/Invoke，调用 Windows 原生 Toolhelp32 API（`CreateToolhelp32Snapshot`、
`Process32FirstW`、`Process32NextW`）枚举 PID/父 PID，并用 `ConvertTo-Json` 序列化；
不依赖 CIM/WMI 服务，也不安装原生包或二进制。编译与所有权查询共用上限为 10 秒的
watchdog，仍受现有执行期限及外层取消约束，没有额外编译时间，也不放宽执行预算。
快照失败仍尝试终止受管进程树，但显式报告失败，不视为清理成功。
强杀、断电或恶意逃逸进程不在自动清理保证内。失败诊断只返回安全 stage/reason，
不输出模型文本、服务端错误或认证内容。

## 性能诊断

整次 probe 耗时包括 Git 快照准备、installation、configuration、sanity 和清理，
并不等于模型推理时间。设置 `PGUIDE_TIMINGS=1` 可在 stderr 查看安全的 JSON 分段计时：
CLI 帮助/配置查询、配置验证、ACP readiness，以及修复会话 initialize、session/new、
prompt 和 cleanup。stdout 仍只有原有观察 envelope；计时不输出 prompt、模型内容或凭据。
文本 `pguide` / `pguide --help` 不启动外部命令，机器可读帮助仍验证子命令协议。

## 快照实现与维护

无需在 Objective 快照安装 node_modules。`pnpm self-check:build` 从 setup helper、
现有 AcpClient、权限策略、进程清理和流式脱敏源码生成 `runtime/*.mjs`；
这是 API 的构建提取，不是手写另一套 ACP 协议。`pnpm self-check:check` 校验产物新鲜度，
默认 `pnpm test` 包含该检查。修改共享源码后重新生成并提交产物。
