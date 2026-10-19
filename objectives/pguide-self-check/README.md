# pguide 本机自查

独立、只观测的本机 Objective，由被检查设备上**已安装的 pguide** 运行；
没有新增 CLI 命令。缺 pguide 时先用 [setup/bootstrap](../pguide-setup/README.md)
补齐安装。旧 setup（含 SSH、`allowSanity` 和 regulation fixture）保持原行为。
后续远程整备应以 B 的 pguide 运行本自查达到 terminal 为依据，不能用 A 的结果替代。

## 输入与运行

subject 示例（路径必须属于当前设备和用户，且均为绝对路径）：

```json
{
  "workingDirectory": "D:\\self-check",
  "configPath": "C:\\Users\\me\\AppData\\Roaming\\pguide\\config.yaml",
  "scratchDirectory": "D:\\self-check\\scratch",
  "pguide": {"command": "pguide"},
  "agent": "existing-acp",
  "timeoutMs": 20000
}
```

Windows 也可将 pguide 指定为 Node + 已安装的绝对 JS 入口：
`{"command":"C:\\Program Files\\nodejs\\node.exe","args":["D:\\installed\\pguide\\dist\\bin.js"]}`。
可选 `desiredVersion` 精确匹配版本；可选 `userHome` 仅指定本机现有 HOME，
不复制认证。有效配置按 pguide 的用户→项目→explicit 规则在 workingDirectory
读取。不要指向非预期项目 override，不要在 subject 中放凭据。
`target`（包括 local/SSH）及 `allowSanity` 均不是本自查输入，提供时拒绝。

用已安装的 pguide 与提交过的 Git 子目录快照运行（将 URI、revision、subject 替换为实际值）：

```powershell
pguide probe --pilot "git+file:///D:/Code/potential-guide#objectives/pguide-self-check/pilot.yaml" --revision <commit> --subject-file D:\self-check\subject.json --config C:\Users\me\AppData\Roaming\pguide\config.yaml --format json
```

这条 probe 会执行一次 sanity；不要紧接着为“确认”重复运行，避免额外模型调用。
也可在已授权的 regulation 中使用同一 Pilot；自查内部不会再次 regulate。
直接诊断入口为 `node objectives\pguide-self-check\self-check.mjs <installation|configuration|sanity> --subject-file D:\self-check\subject.json`。
单独运行 helper 成功**不等于**完整 Pilot terminal，更不等于真实设备验收通过。

## 分级与边界

`initial → installed → configured → terminal`，每个显式 level 只有一个 advancement check：

- installation：指定安装的结构化身份/版本及可选 desiredVersion。
- configuration：复核安装、配置、config/probe/regulate 发现和所选 ACP stdio
  profile；真实 initialize + session/new，不 prompt。AHP 明确不支持。
- sanity：复核依赖、ACP readiness，在独占 scratch/task 下创建错误的 marker.txt，
  **一次** AcpClient.prompt，要求只改 marker.txt，然后独立核验普通非链接文件、
  单硬链接、大小和随机精确内容。仅摘要、错误内容、拒绝权限都不通过。

执行 self-check 已包含一次低损耗 sanity，不另加 allowSanity 检查级授权。
真实工具授权仍须遵守：沿用 profile 原有参数及有效配置 regulationPermissions，
使用 pguide 现有权限策略，不自动生成 grants，不增加 allow-all，不修改用户配置。
权限拒绝即失败，即使文件碰巧已正确也不通过。模型不可用、额度不足不重试。
不承诺免费。小任务不要求 Git、网络、安装或提交；Git 仅为外层加载 Objective
快照所需。隔离 cwd 不是恶意全权限 Agent 的安全沙箱。

每个 check 默认总预算 20 秒，Pilot subject 上限 24 秒，为 probe 默认 **30 秒**
留进程树清理余量；预算包含命令发现、ACP readiness、一次 prompt 和清理。
直接 helper 可显式使用最多 300 秒，但长 helper 成功不能冒充默认 probe terminal。
Agent 原始 stdout+stderr 上限 192 KiB，外围进程 stdout+stderr 上限 256 KiB。
已有 agentExecutionLimits.timeoutMs 若更短仍生效，不放宽用户执行期限。
超时/输出超限终止受管进程树；无重试，只删除本次 mkdtemp 独占目录及其状态，
不删除 scratch 根目录或其他任务。Windows 需 taskkill，POSIX 需 ps。
强杀、断电或恶意逃逸进程不在自动清理保证内。失败诊断只返回安全 stage/reason，
不输出模型文本、服务端错误或认证内容。

## 快照实现与维护

无需在 Objective 快照安装 node_modules。`pnpm self-check:build` 从 setup helper、
现有 AcpClient、权限策略、进程清理和流式脱敏源码生成 `runtime/*.mjs`；
这是 API 的构建提取，不是手写另一套 ACP 协议。`pnpm self-check:check` 校验产物新鲜度，
默认 `pnpm test` 包含该检查。修改共享源码后重新生成并提交产物。
