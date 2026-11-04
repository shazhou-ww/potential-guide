# 配置边界与改造范围

本文件服务于 [Idea](Idea.md)，保留已交付声明式服务的边界，将运行端收敛为仅标准只读 Gateway。
本次新增范围不由旧验收自动覆盖，也不把所有内部回调变成配置字段。
已交付基线为 `242d4b32f4a4c1b4a0da772e26c23a76bf524e73`。

## 当前问题

- [CLI 入口][cli]已支持声明式四层配置、Engine 与可选 UI；旧模块配置已退役。
- [ServerOptions][server]保留 client、授权和资源回调注入；运行端内容接口实际只要求
  `block.get(cid)`，并由[内容层][ipfs]逐块校验 CID。
- [示例配置][example]已为 YAML；历史 `IPFS_API` 不属于隐式配置层。
- [pguide][pguide] 已发现并分派 `pguide-<command>` binary；[设置机制][settings]
  使用用户/项目 JSONC、包级设置描述和完整 setting ID，不需要另一套全局目录。
- Web UI 已有独立 JSON 配置和公开 HTTP 客户端边界。本次新增可选启动装配，
  不把 UI 变成 Engine 的进程内调用方，也不改变现有独立连接能力。
- 当前服务装配有 RPC/Gateway 两种 transport；本次移除服务的 RPC 与 transport 选择，仅保留 Gateway。

## 本候选的目标与规则

### 命令归属与可选 Web UI

- 方向为 `@potential-guide/pguide-task-engine` 提供 `pguide-task-engine` binary，
  可独立使用，也可被既有发现机制作为 `pguide task-engine` 调用。
  复用命令发现、冲突拒绝和结构化 help 协议，不建立第二个命令路由器。
- 该命令负责服务启动与装配：支持仅 Engine，以及显式选择同时启动 Web UI。
  具体动作名、选项名和旧 `task-engine-server` binary 的保留或迁移方式在实施时统一，
  但保留的入口必须走同一配置规则，旧 `.mjs` 执行入口必须退役。
- 同时启动不意味着统一系统 daemon。Engine 和 UI 继续经公开 HTTP 交互，
  UI 不读取 Engine 数据库、不直接调用 Engine 对象，也不管理 Kubo。
  明确报告各自实际监听地址；未选择 UI 就不启动 UI。
- 前台组合启动只拥有本次创建的服务。启动失败须清理本次资源，退出时停止本次服务；
  不连接后接管、停止或替换已有 Server/UI，也不因关闭浏览器而取消 Task。
- `pguide task-engine` 与另一个 Idea 的 `pguide task-bundle` 是同级命令。
  本 Idea 不实现 Bundle 的 check/build/publish、`task.build.yaml`、TypeBox 生成、
  `dist/task.yaml` 或发布清单；作者工具由 Idea `01M6GWRMT65XKB6QZKPYE6JEXD` 负责。

### 多种输入与统一优先级

同时支持命令行参数、服务命令 `--config` 指定的 YAML/JSON，
以及现有 pguide 用户级 `config.jsonc` 中该命令的设置：

```text
命令行显式参数 > --config 指定文件 > pguide 用户级 JSONC 设置 > 内置默认值
```

用户已选择保留这四层：最近项目 `.pguide/config.jsonc` 不自动参与服务配置。
这不取消 pguide 其他命令的项目设置，也不把发现命令所需的配置误算成服务值来源。
用户级配置复用 pguide 包级设置描述、命名空间和来源信息，不新增专用隐藏全局目录。

允许仅使用参数启动，或使用文件并覆盖个别字段。解析器的默认值不能伪装成显式参数，
覆盖文件中用户已经设置的值。每个启用来源先校验其已提供字段，合并后再校验最终配置；
被高层覆盖的非法值仍必须报错，不丢弃后回退默认值。只有未提供的设置才使用默认值。
禁用的用户层不读取、不参与校验。各来源使用同一字段契约，不保留四套合法性规则。

服务直接提供 Gateway URL，不再选择 transport：

```powershell
pguide task-engine --config server.yaml --port 3001
pguide-task-engine --host 127.0.0.1 --port 3000 --database .\tasks.sqlite --ipfs-gateway-url http://127.0.0.1:8080
```

```yaml
host: 127.0.0.1
port: 3000
database: ./tasks.sqlite
ipfsGatewayUrl: http://127.0.0.1:8080
```

服务文件使用单层 `ipfsGatewayUrl`，CLI 使用 `--ipfs-gateway-url`，
用户设置使用完整 ID `task-engine.ipfsGatewayUrl`，没有嵌套 transport 结构。
Gateway URL 必须由启用的配置来源显式提供；缺少时在启动副作用前失败，不选择公共服务或隐藏默认节点。
移除 `ipfsRpcUrl`、`ipfsTransport`、对应 CLI flag 和用户 setting ID；
旧字段在启用来源中即使被覆盖也明确拒绝并提示迁移，不静默忽略或自动改写用户文件。

### 标准只读 Gateway

- 使用 [IPFS Trustless Gateway 标准](https://specs.ipfs.tech/http-gateways/trustless-gateway/) 的
  raw-block 接口：`GET /ipfs/{cid}?format=raw`，请求类型为 `application/vnd.ipld.raw`。
  客户端自行解释 UnixFS/DAG 并验证每个块的 CID，不接受任意文件下载替代内容身份校验。
- Gateway URL 遵循同一四层覆盖及逐层校验规则，包括被覆盖的非法值仍失败；
  禁用用户层仍完全不读取。Gateway 是服务唯一内置读取后端，没有 RPC 默认值、探测或回退。
- URL 仅 HTTP(S)，不携带用户凭据、query 或 fragment；保留显式 base path 的含义，
  拒绝重定向，不隐式继承用户凭据。响应类型与流读取受约束：
  有超时、取消、逐块字节上限和现有 DAG/总量上限，不能先无界缓冲再检查。
  错误状态、错误内容类型、CID 不匹配、超限与不可达均明确失败，不悄悄切换内容源。
- Engine-only、可选 UI、程序化内容注入和本机访问策略不变；Gateway 后端可由任意兼容
  HTTP 服务提供，不要求本机 Kubo 可执行文件、RPC、节点管理或网络 peer 功能。
- 作者导入、写块和 pin 仍可使用现有 Kubo RPC；仅供作者调用的 RPC helper 不属于本次移除范围，
  服务不得导入或调用它。读取与发布分离，不增加写入 Gateway 协议，
  不承诺远端内容可用性或持久保存，不把公共 Gateway 的稳定性作为验收前提。

配置仅描述数据，不执行 JavaScript、模块导入或安装钩子。
旧 `.mjs` 配置必须明确拒绝并给出迁移提示，不能作为隐式回退继续执行。
该变更不取消程序化 API：嵌入者和测试仍可直接传入 client 与回调。

复用 pguide 的完整 setting ID 覆盖单位：对象和数组整体替换，不做隐式深合并，
显式对象须满足该设置的完整要求。除上述 Gateway 命名外，其余 setting ID、服务文件字段和 flag 映射在实施时定义；
需要单独覆盖的能力应有明确设置粒度，不能把点号临时解释成任意对象路径。
共享 JSONC 中其他包的合法设置不算服务未知字段；服务命名空间内未知字段明确失败，
共享结构错误和注册损坏仍按现有规则处理，不借此重写其他命令的配置语义。

### 路径和用户级全局配置

- 用户文件使用现有 pguide 路径：Windows 为 `%APPDATA%\pguide\config.jsonc`
  （APPDATA 未设置时沿用用户目录下 `AppData\Roaming`），其他平台为
  `$XDG_CONFIG_HOME/pguide/config.jsonc`，未设置时为 `~/.config/pguide/config.jsonc`。
  不再自动搜索独立的 Server YAML/JSON 全局文件，也不并行选择多种全局格式。
- `--config` 参数的相对文件路径按调用进程当前目录解析。
- 每个配置文件里的相对路径按该文件自身目录解析；
  命令行里直接提供的相对路径按当前工作目录解析。
  混合覆盖不得把来自全局文件的数据库路径重新锚定到指定文件目录或 CWD。
  此来源锚点规则适用于新增服务设置，不改变 pguide 其他设置已定义的路径语义；
  实施须明确 pguide `--cwd` 透传后的有效工作目录，两种入口使用同一解释。
- “全局”限定当前用户，不是机器所有用户共享，也不是仓库内的默认配置。
- 默认自动读取全局配置；文件不存在可继续使用其他来源和默认值。
  已存在但无效、不可读取的全局配置必须明确失败，不静默忽略。
  显式指定的配置文件不存在同样应报错，不当作可选文件。
- 提供 `--no-global-config` 完全禁用用户主配置读取，供测试及隔离启动使用。
  独立 binary 和 `pguide task-engine` 都必须满足；上层命令发现不能先读取被禁用文件。
  禁用用户层时不使用其中的 commandDirectories，仍使用既有可用发现来源，
  找不到扩展时明确失败，不悄悄读回用户配置。
- `--help` 说明优先级、路径规则、默认全局配置路径和隔离开关；
  帮助显示不应依赖成功连接 Kubo、Gateway 或执行用户配置。

现有 pguide 通用参数解析会拒绝 `--config`，通用设置加载会合并项目层。
实施须对服务命令提供必要、显式的参数透传及来源选择适配，并测试从顶层入口到实际启动的完整链路；
不能只让独立 binary 可用，也不能为此恢复所有命令已退役的全局 `--config`。
不新增仓库自动服务配置层或任意环境变量覆盖层，不自动改写用户文件或注册设置包。

### 本机访问与身份边界

本候选采用已讨论的本机受信服务方向：CLI 不要求 token，但只能监听固定 loopback，
默认 `127.0.0.1`，`localhost` 必须归一到固定回环地址；拒绝 `0.0.0.0`、
局域网地址和其他非回环监听。具体 IPv6 支持与映射需在实施时明确。
这不隔离本机其他用户或恶意进程，不授权通过代理对外提供无鉴权服务。

免 token 不等于删除权限边界：装配明确的本地 Caller 与范围策略，不把所有范围无条件放行。
服务须防护非预期浏览器跨站访问，明确 Host/Origin、写操作方法与内容类型约束，
不能仅依赖 CORS；保留 Web UI 既有的本地访问与 CSRF 防护。
程序化认证/授权注入继续可用。此设计属于新候选的审阅范围，之前的讨论不算验收。

### 装配与失败边界

- CLI 读取并校验最终配置，仅创建 Gateway 读取 client，传入 Server。
  程序化 `startTaskServer({ipfsClient, ...})` 继续保持资源注入方式；
  不要求 Engine 自行寻找节点、读取 Kubo 数据仓库或启动 daemon。
- 未知字段、非法类型/值和配置解析错误明确报错，不返回成功形默认值。
  Engine 与所选 UI 的配置校验应在开放监听、接管数据库等启动副作用前完成。
- 声明式配置不直接序列化 `authorize`、`resolveCaller`、`fetchIpfs`、
  `closeResources` 等函数。实现须核对现有 CLI 必需的认证/Caller 和资源装配，
  按本机身份边界提供明确的内置适配，不用默认为全部允许来掩盖缺失。
  这一项是现有程序化入口到 CLI 的适配要求，不要求扩建新的权限产品。
- 不在版本库保存本机凭据或用户配置；错误、帮助和诊断不能泄漏敏感字段。
- 原示例环境变量如何转换为新的参数或文件配置，必须在文档中交代，
  不把示例历史行为悄悄提升为高于显式 CLI 的隐式优先级。

## 调整表面与证明

| 表面 | 需要调整 | 证明方式 |
| --- | --- | --- |
| pguide 扩展入口 | 扩展包、binary、发现及 help 协议，必要的参数和来源选择适配 | 独立安装后发现/分派；两种入口配置、禁用和错误行为一致 |
| Server CLI | 参数解析、文件/全局读取、统一校验与装配；退役执行模块配置入口 | 参数/文件启动与非法输入进程测试，证明旧模块不会被执行 |
| 可选 Web UI | 显式前台启动装配和仅本次资源的关闭责任 | 仅 Engine 不启动 UI；带 UI 经 HTTP 消费，失败清理不影响既有服务 |
| IPFS 装配 | 仅 Gateway 地址由有效配置确定，无 RPC 默认值或分支；程序化读取注入保持 | 无 RPC 的标准 raw-block HTTP 消费、逐块完整性与限额拒绝、旧字段拒绝及作者写入回归 |
| Server 参数与访问 | 显式映射字段、loopback 与本地 Caller 策略，保留程序化回调 | 非回环和跨站访问拒绝；程序化回归与监听、数据库、资源关闭验证 |
| pguide 用户设置 | 既有 JSONC 路径与描述机制，排除项目服务值，支持禁用 | 隔离用户目录与冲突项目设置矩阵；损坏用户文件在禁用后不读取 |
| 覆盖规则 | 四层完整设置覆盖；逐层校验且区分省略与显式值 | 被覆盖的非法值仍失败；对象/数组替换及多来源路径矩阵 |
| 文档与消费者 | pguide/Server/UI help 与指南、例子、直接验证脚本 | 真实独立发现与启动；不留下执行模块配置或 Bundle 作者子命令 |

实施前核对直接引用旧 CLI 的测试、打包消费和验证脚本，更新必要调用方，
但不改写其他 Idea 的历史证据。优先复用仓库已存在的声明式解析和 CLI 配置机制，
不为本任务引入不必要的配置框架。实现细节不能增加全局配置写入或自动迁移的隐含副作用。

## 非目标与当前状态

不实现系统 daemon、后台常驻管理、托盘、开机自启或热重载；仅做服务入口所需的 UI 配置映射，
不重构无关 UI 功能或重建已移除的公开 Bundle 缓存 API/UI。
不管理 Kubo 的启动/停止、IPFS_PATH、pin 或 GC；不改变 Task/Run/Bundle 领域语义。
当前修订 Gateway-only 构想和下游种子；旧双 transport 验收证据仅证明旧范围，不操作已有服务或真实用户配置。
发布命令、安装级配置定位和独立验证可以使用本地产物，不构成 npm 发布授权。
旧 Ideal 提交不覆盖这次实质范围变更；新候选须同步并重新 submitIdeal 后等待明确验收。

[cli]: ../../../../../../apps/pguide-task-engine/src/main.ts
[server]: ../../../../../../packages/task-engine-server/src/index.ts
[example]: ../../../../../../examples/task-server/server.yaml
[ipfs]: ../../../../../../packages/ipfs-content/src/index.ts
[pguide]: ../../../../../../packages/pguide/README.md
[settings]: ../../../../../../docs/package-settings.md
