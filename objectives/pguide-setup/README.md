# 当前设备、当前用户的 pguide setup Objective

本目录是独立的 Pilot，不增加 `pguide setup` 命令。所有检查只使用 Node.js
内置模块，不需要此快照安装 `node_modules`。运行器由当前设备已经安装的
`pguide` 提供；检查不会安装软件、修改用户配置或执行真实项目。

## 外部 Agent bootstrap（还没有 pguide 时）

1. 读取本文件，确认 Node.js ≥22.13、Git 和当前用户身份。进程树清理需要 Windows 的
   `taskkill` 或 POSIX 的 `ps`（包括 Agent 建立的独立进程组）。外部 Agent 可以直接运行
   `node objectives\pguide-setup\setup-check.mjs installation --subject-file D:\setup\subject.json`。
   `installation-missing` 是待解决的问题，不是 bootstrap 自身失败。
2. 向用户说明软件来源与目标版本后再按授权安装。发布版本可以使用
   `npm install --global pguide@<明确的版本>`；不要认为 registry 的 `latest`、
   `rc` 或同名版本已经包含当前源码。当前源码中尚未发布的功能应使用此仓库准确的
   commit，按根目录说明运行 `pnpm install`、`pnpm build`，再指向该构建，或按设备策略
   链接它。不要在运行检查时自动安装，也不要把 setup 加成应用依赖。
3. 优先检查执行 setup 的 Agent 是否**确实提供可运行的 ACP stdio 命令**以及其认证方式。
   当前 IDE 聊天并不自动等于 ACP 入口。没有已知 ACP 入口时明确报告，选择用户已有的
   其他 ACP Agent；不要伪造入口、读取/复制令牌、自动申请订阅或付费资源。
4. 使用安装后的 `pguide config path` 找到当前用户配置，设置 schemaVersion 2、
   ACP profile 与 defaultAgent（或者 subject.agent）。`pguide config validate` 只检查
   配置语法；本 Objective 还必须成功 initialize 和 session/new。只对用户明确同意的配置
   作修改；setup 检查本身永不修改它。
5. 先检查 installation 和 configuration。只有用户明确同意可能产生模型费用、
   一次 Agent 执行和以下时间边界后，才把 `allowSanity` 改为 `true` 并运行 sanity。
   失败后是否重试须重新考虑成本；不要循环运行带授权的完整 Pilot。

## Subject（只放非秘密信息）

所有目录及配置路径必须是本机**绝对路径**。`workingDirectory` 定义配置合并上下文；
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

## 运行与结果

本地直接检查，未安装 pguide 也可运行第一条：

```powershell
node objectives\pguide-setup\setup-check.mjs installation --subject-file D:\setup\subject.json
node objectives\pguide-setup\setup-check.mjs configuration --subject-file D:\setup\subject.json
# 用户明确同意并在 subject 中设置 allowSanity:true 后：
node objectives\pguide-setup\setup-check.mjs sanity --subject-file D:\setup\subject.json
```

也可以向 stdin 发送 subject JSON；`checks\*\run.cjs` 使用相同协议。
stdout 恰好一份 CheckResult Envelope：`status:200` 的 `payload.ok:false` 是声明的
业务问题；`payload:null` 是输入、协议、I/O、输出上限或超时调用故障，不是成功或
“暂未安装”。退出码不是检查成功依据。不要记录子进程原始输出，它可能含认证信息。

通过仓库 Git 子目录加载，固定提交而非未提交的工作区：

```powershell
pguide validate pilot .\objectives\pguide-setup\pilot.yaml
pguide probe --pilot "git+https://github.com/shazhou-ww/potential-guide.git#objectives/pguide-setup/pilot.yaml" --revision <完整提交哈希> --subject-file D:\setup\subject.json --format json
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

默认每个 helper 总期限 20 秒，可配置 100–24000 毫秒；sanity 内部 Agent/调节配额至多
12 秒、一次 Agent、一次 stall、probe 至多 3 秒且不重试。stdout+stderr 合计上限
256 KiB，超时/超限按 PID 终止进程树；配置、state、fixture 都位于独占目录并最终清理。
helper 清除继承的 `GIT_*` 覆盖并禁用全局/系统 Git 配置，避免索引、工作树、模板、
hooks 或签名配置把测试带到其他仓库；同样覆盖 `PGUIDE_STATE_DIRECTORY` 到独占目录。
不能设置准确金额预算；用户同意的是一次有界执行，具体计费依 Agent/供应商。
核心 process probe 默认 30 秒，helper 上限预留清理时间；不要用更短的外层 deadline
打断清理。正常完成和内部超时均清理；操作系统强杀/断电不能保证 finally，遇到残留时先
确认关联进程已终止，再只删除本次拥有的目录，绝不能清理其他任务的 scratch。

## 仓库验证

```powershell
pnpm --filter pguide exec tsx --test test\setup-objective.test.ts
```

测试使用本仓库构建出的 pguide composition 和真实本地 ACP fixture 子进程，
不安装全局软件、不修改当前用户配置、不访问真实模型。
