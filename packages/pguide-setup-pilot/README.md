# 从控制机 A 配置目标机 B 的 pguide setup Objective

本 Pilot 是完整的私有 workspace package。manifest、References、源码、测试、
内嵌 sanity fixture 和生成的 SSH runtime 同版本交付；
构建/新鲜度命令为 `pnpm setup:build` / `pnpm setup:check`。
职责与历史 URI 迁移见 [Pilot packages](../../docs/pilot-packages.md)。

已有本机 pguide 的设备优先运行独立的
[本机自查 Objective](../pguide-self-check-pilot/README.md)：默认一次直接 Agent marker 修复，
不嵌套 regulation、不需要 allowSanity。本文旧 bootstrap/setup 的授权及 SSH 行为不变；
后续远程整备接入新自查仍待单独实施。

本目录是独立的 Pilot，不增加 `pguide setup` 命令。所有检查只使用 Node.js
内置模块，不需要此快照安装 `node_modules`。运行 setup 调节的控制机 **A 已经具备
pguide 和可用 Agent**；subject 描述要安装、配置、验证的目标机 **B**。A 的控制
Agent 根据检查结果和引导、按授权在 B 安装配置前置条件；检查本身不会安装软件、
修改用户配置或执行真实项目。A 上的安装、认证或成功运行不是 B 就绪的证据。
省略 `target` 或设置 `{"type":"local"}` 保留旧的本地 bootstrap 行为（A=B）。
本 Pilot 的就绪检查仍限定 ACP stdio，兼容规范化的顶层 `type: acp` 和合法旧
`connection.type: acp` 配置。pguide 运行时支持 AHP 不代表本 Pilot 已验证 AHP；
若所选 profile 是 `type: ahp`，检查明确返回 `acp-unavailable`，不会把它当作
损坏配置或退回另一个 Agent。

## 控制 Agent bootstrap（B 还没有 pguide 时）

1. 读取本文件，确认目标 B 的 Node.js ≥22.13、Git 和用户身份。进程树清理需要 Windows 的
   `taskkill` 或 POSIX 的 `ps`（包括 Agent 建立的独立进程组）。外部 Agent 可以直接运行
   `node packages\pguide-setup-pilot\setup-check.mjs installation --subject-file D:\setup\subject.json`。
   SSH 时 helper 从 A 经 stdin 发送到 B，不需要预装 pguide、pnpm 或 npm 依赖。
   若 B 连 Node 都没有，返回 `remote-node-missing`；控制 Agent 应先按授权通过既有 SSH
   管理方式安装 Node，再重新检查，绝不改为检查 A。
   `installation-missing` 是待解决的问题，不是 bootstrap 自身失败。
2. 向用户说明软件来源与目标版本后再按授权安装。发布版本可以使用
   `npm install --global pguide@<明确的版本>`；不要认为 registry 的 `latest`、
   `rc` 或同名版本已经包含当前源码。当前源码中尚未发布的功能应使用此仓库准确的
   commit，按根目录说明运行 `pnpm install`、`pnpm build`，再指向该构建，或按设备策略
   链接它。不要在运行检查时自动安装，也不要把 setup 加成应用依赖。
3. 优先检查执行 setup 的 Agent 是否**在 B 上确实提供可运行的 ACP stdio 命令**以及其认证方式。
   当前 IDE 聊天并不自动等于 ACP 入口。没有已知 ACP 入口时明确报告，选择用户已有的
   其他 ACP Agent；不要伪造入口、读取/复制令牌、自动申请订阅或付费资源。
4. 在 B 使用安装后的 `pguide config path` 找到目标用户配置，设置 schemaVersion 2、
   ACP profile 与 defaultAgent（或者 subject.agent）。`pguide config validate` 只检查
   配置语法；本 Objective 还必须成功 initialize 和 session/new。只对用户明确同意的配置
   作修改；setup 检查本身永不修改它。
5. 先检查 installation 和 configuration。只有用户明确同意可能产生模型费用、
   一次 Agent 执行和以下时间边界后，才把 `allowSanity` 改为 `true` 并运行 sanity。
   失败后是否重试须重新考虑成本；不要循环运行带授权的完整 Pilot。

## Subject（只放非秘密信息）

所有目录及配置路径必须是**目标机绝对路径**，不得把 A 的工作区、配置或 HOME 当作 B。
`workingDirectory` 定义配置合并上下文；
真实命令的操作 cwd 是独占 scratch 或其中的测试仓库。
`configPath` 必须存在，表示明确的当前用户配置目标；有效配置仍按 pguide 的
用户 → 项目 → explicit 合并规则读取。建议 workingDirectory 使用没有项目配置的
当前用户目录，避免意外复用项目 override。配置文件不得存储秘密字面量。

```json
{
  "workingDirectory": "D:\\setup",
  "configPath": "C:\\Users\\me\\AppData\\Roaming\\pguide\\config.yaml",
  "scratchDirectory": "D:\\setup\\scratch",
  "pguide": {
    "command": "C:\\Program Files\\nodejs\\node.exe",
    "args": ["D:\\Code\\potential-guide\\packages\\pguide\\dist\\bin.js"]
  },
  "desiredVersion": "0.3.0-rc.0",
  "userHome": "C:\\Users\\me",
  "agent": "existing-agent",
  "allowSanity": false,
  "timeoutMs": 20000
}
```

SSH 示例（POSIX B；本机保存的 subject 文件路径仍是 A 的路径）：

```json
{
  "target": {
    "type": "ssh",
    "host": "worker@build-target",
    "shell": "posix",
    "node": "/usr/bin/node",
    "port": 22
  },
  "workingDirectory": "/home/worker",
  "configPath": "/home/worker/.config/pguide/config.yaml",
  "scratchDirectory": "/home/worker/setup-scratch",
  "pguide": {"command": "pguide"},
  "agent": "existing-agent",
  "allowSanity": false,
  "timeoutMs": 14000
}
```

### SSH MVP 的明确边界

- 只支持 B 的 POSIX shell；Windows B、交互登录、密码/验证码提示、IPv6 字面量和
  自定义 SSH 参数不在此 MVP 内。`host` 是安全 SSH alias 或 `user@host`；
  IPv6 可通过已有 SSH alias 连接。`node` 默认 `node`，可给不含空格/元字符的绝对路径。
  不运行任意 shell 字符串；pguide/Agent 的参数仍由目标 Node 分项启动。
- A 必须已有 SSH 客户端、非交互授权和可信 known_hosts。使用 BatchMode、
  StrictHostKeyChecking=yes，绝不自动接受 host key；禁用 agent/X11/端口转发、
  LocalCommand、连接复用及环境转发。保留既有 SSH alias/ProxyCommand 配置，
  它们是 A 管理员已有的信任边界，不应接受陌生配置。
- 不上传 A 的配置、认证文件、环境变量或 HOME。SSH subject 禁止 `userHome`；
  B 的 HOME/环境来自 B 的登录会话，ACP profile 仍须显式声明所需变量名。
  非交互 PATH 可能不同，必要时给 B 的 Node、pguide 和 ACP 入口绝对路径。
- 经 stdin 发送有界 JSON（原生 helper 和固定 sanity fixture），B 在其指定
  scratch 下创建独占目录、执行并清理；不用 scp、全局临时目录、npm 安装或预装 helper。
  `installation` 检查不要求 Git；完整 sanity 需要 B 的 Git 和进程清理工具。
- SSH 本地期限为 `timeoutMs + 10000`，连接期限 5 秒，stdout+stderr 上限 256 KiB。
  断开连接会终止 A 的 SSH 进程树；B 收到 HUP/TERM 时取消检查并清理，未收到时由 B
  自身期限完成清理。操作系统强杀/断电仍不能保证清理，不承诺远程断连时立即完成删除。
- `ssh-unavailable`、`ssh-unreachable`（连接/授权/主机信任失败）、`remote-node-missing`、
  `remote-helper-failed`、`remote-helper-protocol` 和 `ssh-timeout` 是明确调用故障。
  不输出原始服务器 stderr，不静默回退到 A。成功抵达 helper 的 Envelope.message
  包含 JSON：连接 alias、B 自报 hostname/user、检查诊断；alias 不等同 hostname，
  身份不是独立硬件证明，实际 SSH host key 信任仍由已有配置保障。

`pguide.command` 是已安装的原生可执行文件或完整 `.cmd` 路径；也可用 Node +
绝对 CLI 入口（推荐用于源码和含 shell 特殊字符的 Windows 路径）。参数逐项传递；
不接受 shell 命令字符串。POSIX 可直接使用 `pguide`；Windows npm 安装可使用
`C:\Users\me\AppData\Roaming\npm\pguide.cmd`。Windows shim 参数中的 shell 元字符会被拒绝；
请改用 Node 入口，不要通过 shell 包装绕过。

`desiredVersion` 可省略；提供时按 `--version --format json` **精确匹配**。
版本号不证明来源 commit；源码使用者须另外核对构建和 commit。
`agent` 可省略，届时必须有有效的 defaultAgent。
源码构建还需要有效的扩展发现。在选定配置的 `commandDirectories` 中加入已验证的绝对
shim 目录，其中 `pguide-config` 指向 `packages\pguide-config\dist\bin.js`，
`pguide-probe`、`pguide-regulate` 分别指向 `packages\pguide\dist\bin\probe.js`、
`packages\pguide\dist\bin\regulate.js`。可使用设备级已链接安装提供的 shim；不要假设
旧的 workspace `node_modules\.bin` shim 已更新。先核对 `pguide --help --format json`
中三条命令均 `compatible:true` 且没有 conflicts；仅 help 退出成功不算配置就绪。

### 认证与执行环境：两种入口不可混淆

- **本地直接 bootstrap** 继承调用者 shell 环境，以便 pguide 使用已经登录的 Agent。
  Profile 的 `transport.env` 只列变量**名称**，例如 `[HOME]`、`[USERPROFILE]` 或
  `[PROVIDER_API_KEY]`；不要把值写入 Subject、命令参数、profile、结果或仓库。
  pguide 启动 Agent 时只传递明确声明的变量及自身最低系统变量。
- **Git Pilot probe** 的运行环境由 pguide 刻意裁剪，Windows 通常没有用户目录变量，
  两个平台也不传递模型 token。这里不放宽核心边界。可声明非秘密绝对 `userHome`，
  helper 只补入 `HOME`、`USERPROFILE`；profile 必须再通过 `transport.env` 明确选择
  它们。Agent 可以自行使用该用户已登录的文件认证；helper 不读取认证文件。
- **SSH target** 使用 B 已有环境和认证；即使 A 上缺少模型变量也不能使用 A 的登录态
  代替 B 的认证。上面 `userHome` 的本地补入行为不适用于 SSH。
- 其他必需环境引用缺失时返回 `environment-unavailable`，不会偷偷寻找值。依赖
  环境 token 的 Agent 可在已有认证 shell 中直接检查，但这**不是**后续 Git Pilot 的
  terminal 凭证；没有 receipt/cache 绕过。需要 Git Pilot 达到 terminal 时应选择支持
  既有文件认证/原生凭据存储且确实可从上述环境启动的 Agent。
- `userHome` 不修改系统用户，不复制登录态，不推断 ACP 兼容性。检查结果仅证明当前
  观察的设备、用户、配置和时间，不是永久安装凭证。

示例非秘密 profile（替换为实际已存在的 ACP 命令，不要原样假设某产品支持）：

```yaml
schemaVersion: 2
defaultAgent: existing-agent
agents:
  existing-agent:
    connection: {type: acp, protocolVersion: "1"}
    transport:
      type: stdio
      command: "C:\\tools\\actual-acp-agent.exe"
      args: []
      env: [USERPROFILE]
```

配置的 `protocolVersion` 保持规范十进制字符串 `"1"`；ACP initialize 在线协议中发送
数字 `1`，并严格要求数字响应。拒绝时 `acp-unavailable` 可包含安全的
`stage`（initialize/session-new）、`reason` 枚举；不会回显可能含秘密的服务端 error。

## 运行与结果

本地直接检查，未安装 pguide 也可运行第一条：

```powershell
node packages\pguide-setup-pilot\setup-check.mjs installation --subject-file D:\setup\subject.json
node packages\pguide-setup-pilot\setup-check.mjs configuration --subject-file D:\setup\subject.json
# 用户明确同意并在 subject 中设置 allowSanity:true 后：
node packages\pguide-setup-pilot\setup-check.mjs sanity --subject-file D:\setup\subject.json
```

上述命令也用于 SSH subject：命令在 A，检查与真正的 pguide/Agent 执行在 B。
运行 setup regulation 的 Agent 在 A；sanity 内部调用的 Agent 是 B 配置中的 Agent。
控制 Agent 不得仅凭 A 的成功输出宣称远端 terminal。

也可以向 stdin 发送 subject JSON；`checks\*\run.cjs` 使用相同协议。
stdout 恰好一份 CheckResult Envelope：`status:200` 的 `payload.ok:false` 是声明的
业务问题；`payload:null` 是输入、协议、I/O、输出上限或超时调用故障，不是成功或
“暂未安装”。退出码不是检查成功依据。不要记录子进程原始输出，它可能含认证信息。

通过仓库 Git 子目录加载，固定提交而非未提交的工作区：

```powershell
pguide validate pilot .\packages\pguide-setup-pilot\pilot.yaml
pguide probe --pilot "git+https://github.com/shazhou-ww/potential-guide.git#packages/pguide-setup-pilot/pilot.yaml" --revision <完整提交哈希> --subject-file D:\setup\subject.json --format json
```

`initial` 表示尚未确认安装；`installed` 已确认版本，但尚未确认配置；
`configured` 已确认配置、Agent 和无 prompt 的 ACP 会话建立；
隐式 `terminal` 才表示本次真实 sanity 完成。没有显式 `verified` 等级：
**terminal 就是 verified**，不会把开始 sanity 当成完成。

configuration 会启动实际 ACP 进程但不发送 session/prompt，不主动调用付费模型。
如果某 Agent 在 initialize/session/new 自身就执行付费操作，请不要选用它进行无费用检查。
sanity 每次在 scratch 下新建私有 `pguide-setup-*` 目录，复制内置 fixture，初始化并提交
Git 仓库，确认错误 marker；以选定配置的 Agent 运行**一次**真正的
`pguide regulate`，然后从固定 commit 再独立 `pguide probe` 并检查随机 48 字节
nonce 的精确内容。空报完成、写错值、改检查器或伪造 report 不会通过独立复核。
这是真实执行证据，不是针对恶意全权限 Agent 的安全沙箱。

默认每个 helper 总期限 20 秒，直接入口可配置 100–300000 毫秒；真实 Agent 冷启动可能
超过默认期限。用户明确同意后可直接使用 `allowSanity:true, timeoutMs:180000`，
不会自动重试真实 prompt。sanity 内部 Agent/调节配额使用总期限，不预先扣除固定启动余量；
准备、执行与复核仍共用外层总期限。一次 Agent、一次 stall、probe 至多 3 秒且不重试。stdout+stderr 合计上限
256 KiB，超时/超限按 PID 终止进程树；配置、state、fixture 都位于独占目录并最终清理。
helper 清除继承的 `GIT_*` 覆盖并禁用全局/系统 Git 配置，避免索引、工作树、模板、
hooks 或签名配置把测试带到其他仓库；同样覆盖 `PGUIDE_STATE_DIRECTORY` 到独占目录。
不能设置准确金额预算；用户同意的是一次有界执行，具体计费依 Agent/供应商。
核心 process probe 默认 30 秒，本地 Pilot 的 run.cjs 默认仍拒绝总预算超过 24000 毫秒。
可在**启动 probe 的显式配置**中设置
`regulationStrategy.probe: { timeoutMs: 75000, retry: { maxRetries: 0, delayMs: 0 } }`，
同时在本地 subject 设置 `allowSanity:true, timeoutMs:60000`；例如使用
`pguide probe --config D:\setup\config.json --pilot <固定 Git URI> --revision <commit> --subject-file D:\setup\subject.json --format json`。
这会实际运行同一 Git snapshot 的检查及随机 nonce 修复/复核，不接受缓存或直接 helper
结果代替 terminal。subject 上限仍为 300000ms；process 总预算必须至少为 subject
期限加 6000ms，留给进程/模块启动、stdin 读取、结果输出和进程树/scratch 清理。
runtime 通过 `PGUIDE_PROBE_TIMEOUT_MS` 注入实际 process 期限，不继承调用者同名变量；
缺少元数据的独立 wrapper 按默认 30000ms 校验，非规范正整数元数据明确失败。
预算不够时返回 `outer-timeout`，不自动重试或扩大期限。
本地 Pilot 的独占 fixture/config/state 位于 runtime-owned `PGUIDE_PROBE_TEMP_DIR`
内，以便外部取消即使强制终止 helper，也由 process probe 终止进程树后清理；
直接 helper 仍使用 subject.scratchDirectory。6000ms 是预算校验余量，不承诺任意
主机负载、操作系统强杀或断电下仍必然成功/完成删除；实际期限和取消始终有效。
嵌套 CLI 的 Git source cache 也置于同一 runtime-owned 目录；仍应保留 Windows Git
路径长度余量，长预算不解除路径限制。安装验证仅在 Windows 缩短 process cache cwd，
已安装入口、subject 工作目录、config、Git URI 和固定 revision 仍为独立消费者的绝对路径。
该设置是每个 check process 的上限，不包含 Git snapshot 加载；regulate 的整个 observation
另受同一个 `probe.timeoutMs` 上限约束，整个 run quota 和 Agent limits 也不变。
SSH 仍保留原有 24000ms cap，不因本地 opt-in 扩大；总预算包含 10000 毫秒传输余量，
因此 Git Pilot SSH subject 须显式设置 `timeoutMs <= 14000`；不要假设真实远端 sanity
能在此时间完成。先运行有界 readiness，实际较慢的 sanity 使用直接 helper 的显式长时限。
直接 sanity 成功不生成 receipt，也不能缓存/伪造下一次 Git Pilot 的 terminal；
当前默认 30 秒 process probe 不支持长时限 terminal，需要未来显式更长的外层契约。
不要用更短的外层 deadline 打断清理。正常完成和内部超时均清理；操作系统强杀/断电不能保证 finally，遇到残留时先
确认关联进程已终止，再只删除本次拥有的目录，绝不能清理其他任务的 scratch。

## 仓库验证

```powershell
pnpm --filter pguide exec tsx --test test\setup-objective.test.ts
```

测试使用本仓库构建出的 pguide composition 和真实本地 ACP fixture 子进程，
并以内部 transport API 注入本地命令 fixture 测试 SSH 请求、远端 payload、错误和清理，
不需要真实 SSH 目标，不支持从生产 subject 注入 transport。
不安装全局软件、不修改当前用户配置、不访问真实模型。
