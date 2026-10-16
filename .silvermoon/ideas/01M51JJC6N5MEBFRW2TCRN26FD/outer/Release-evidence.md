# Deployment RC 发布证据

本记录服务于 [Deployment 契约](./Deployment.md)。产品不是 placeholder：全部八个有功能的候选已通过 GitHub Actions 的 npm OIDC 发布，随后由纯验证工作流取得权威 registry / provenance 回执。没有发布 1.0 或稳定版，没有改变任何包的 latest。

## D-AC01：版本与发布范围

逐包变更分类和 0.x 版本判断见[实现阶段候选清单](./inner/Release-candidates.md)。新包采用 0.1.0-rc.0；Regulator、Supervisor、pguide 的破坏性契约从 0.2 系列升到 0.3.0-rc.0；CLI Core、config 从 0.1 系列升到 0.2.0-rc.0。不发布退役的 objective-guide。

GitHub 的 npm environment 实际查询确认存在且无阻塞 protection rule；新包发布实际成功完成 OIDC token exchange，而非仅根据用户报告判断权限。所有发布 tag 的 commit 均已位于 primary。

- effects 的 producer commit：`4526dd019d806c4d83f45fa60b66dde687e8c669`。
- 其余七包 producer commit：`a8314ddb0a375f9edc97ce496373874e213367c6`。
- 后续验证工具与测试 harness 修订不改变 packages 中的产品源码；已用 Git diff 核实，不覆盖或重发已发布版本。

## D-AC02：真实发布与权威回执

本次 npm publish 返回 HTTP 202，明确说明异步处理需数分钟。各 run 的 **Publish package step 成功**，但最初后置 metadata 检查因传播窗口短而失败。原 run 如实保留为失败；以下每包都有另一次成功的 **verify-published** 回执，该模式跳过 publish、pack 与 dry-run，不重复发布。

| 包 | 产品 RC | 发布 run（Publish step 成功） | 纯验证 run（完整成功） | latest 发布前后 |
| --- | --- | --- | --- | --- |
| `@potential-guide/effects` | `0.1.0-rc.0` | [38876853830](https://github.com/shazhou-ww/potential-guide/actions/runs/38876853830) | [38877790288](https://github.com/shazhou-ww/potential-guide/actions/runs/38877790288) | `0.0.0` → `0.0.0` |
| `@potential-guide/git-source` | `0.1.0-rc.0` | [38878677073](https://github.com/shazhou-ww/potential-guide/actions/runs/38878677073) | [38879102779](https://github.com/shazhou-ww/potential-guide/actions/runs/38879102779) | `0.0.0` → `0.0.0` |
| `@potential-guide/objective-pilot` | `0.1.0-rc.0` | [38879861440](https://github.com/shazhou-ww/potential-guide/actions/runs/38879861440) | [38880188932](https://github.com/shazhou-ww/potential-guide/actions/runs/38880188932) | `0.0.0` → `0.0.0` |
| `@potential-guide/objective-regulator` | `0.3.0-rc.0` | [38880336680](https://github.com/shazhou-ww/potential-guide/actions/runs/38880336680) | [38880664491](https://github.com/shazhou-ww/potential-guide/actions/runs/38880664491) | `0.1.0` → `0.1.0` |
| `@potential-guide/objective-portfolio-supervisor` | `0.3.0-rc.0` | [38880848180](https://github.com/shazhou-ww/potential-guide/actions/runs/38880848180) | [38881183304](https://github.com/shazhou-ww/potential-guide/actions/runs/38881183304) | `0.1.0` → `0.1.0` |
| `@potential-guide/cli-core` | `0.2.0-rc.0` | [38881079032](https://github.com/shazhou-ww/potential-guide/actions/runs/38881079032) | [38881364352](https://github.com/shazhou-ww/potential-guide/actions/runs/38881364352) | `0.0.0` → `0.0.0` |
| `@potential-guide/config` | `0.2.0-rc.0` | [38881550886](https://github.com/shazhou-ww/potential-guide/actions/runs/38881550886) | [38881873782](https://github.com/shazhou-ww/potential-guide/actions/runs/38881873782) | `0.0.0` → `0.0.0` |
| `pguide` | `0.3.0-rc.0` | [38882019173](https://github.com/shazhou-ww/potential-guide/actions/runs/38882019173) | [38882350059](https://github.com/shazhou-ww/potential-guide/actions/runs/38882350059) | `0.0.0` → `0.0.0` |

每个 tag 均为 `<package-id>-v<上述版本>`。成功回执分别核实 name、version、rc 指向、latest 不变、原始 tag 的 producer commit 和以下 sha512 integrity / provenance。发布顺序遵循依赖：effects → git-source / Pilot → Regulator → Supervisor；CLI Core → config；全部上游验证可获取后再发 pguide。

### 不可变产物身份

| 包 | sha512 integrity | provenance |
| --- | --- | --- |
| effects | `sha512-Gzpo5mg3YA3fyJSi0oNWPcFdgrXnzsVf5Z+KtCycZi7nQZFdH6ROW5+eS4y3URi5zIcRQvceWaN2u8vwZ5em5w==` | [attestation](https://registry.npmjs.org/-/npm/v1/attestations/@potential-guide%2feffects@0.1.0-rc.0) |
| git-source | `sha512-U2iGsq5OSj7uuqXdeNfH2uIm2mL6Bcfm9ZxRJWAyD2+UC6snWJO/2y+2a4/UnOkzLQsmFcF6Y99My6YoCXE4Gw==` | [attestation](https://registry.npmjs.org/-/npm/v1/attestations/@potential-guide%2fgit-source@0.1.0-rc.0) |
| objective-pilot | `sha512-7u/rCBIV4vR1maBOVFJ6JczSMcNJIbJa83a8unzoURiRFnUqnLZrzB1Zg6HEoZUaJTpUBAF7ndK33lT/tNKgSw==` | [attestation](https://registry.npmjs.org/-/npm/v1/attestations/@potential-guide%2fobjective-pilot@0.1.0-rc.0) |
| objective-regulator | `sha512-dP28SJRCyMr1NvREoJmYrD1QRTOGkLhc2li00wIYpTEQoaC1PvHjhnANoVWTwJA3S1hbJyJdMZ9ahkJ4FwcWfA==` | [attestation](https://registry.npmjs.org/-/npm/v1/attestations/@potential-guide%2fobjective-regulator@0.3.0-rc.0) |
| objective-portfolio-supervisor | `sha512-Rb6cXFst7u5BAzwGgnjAtcDI8JKofvno4vbp9UIqYpUTRNtIWh7RzXDjZ0z6ojjyKLwEd3vKyU6/XfLZUmT+Jw==` | [attestation](https://registry.npmjs.org/-/npm/v1/attestations/@potential-guide%2fobjective-portfolio-supervisor@0.3.0-rc.0) |
| cli-core | `sha512-Rw1U6HGHM4Ntg04XaoUbGs/oT8dMzhG3eJ/bvf7oD42jfWdbJbCQxQj++rhdlsMBIBuLU/2YX8cRKl8tJ6zZMw==` | [attestation](https://registry.npmjs.org/-/npm/v1/attestations/@potential-guide%2fcli-core@0.2.0-rc.0) |
| config | `sha512-tgNGUXzzvQ+8oE9PFbx5v+EDAeltZJgGcOHBK71arMHVbTLhIJRVL7hTYcEOxJnT+fZZz8VEdjq6siRDQ02dFg==` | [attestation](https://registry.npmjs.org/-/npm/v1/attestations/@potential-guide%2fconfig@0.2.0-rc.0) |
| pguide | `sha512-U0ZUGN4vhrSFlaWEbF2CkqzUwNCQyBa+OwPHSmlxtUxSdGsDJg5W1GzeSFRP7FeANlI5AsE3PcwTFMQr4S+uCA==` | [attestation](https://registry.npmjs.org/-/npm/v1/attestations/pguide@0.3.0-rc.0) |

本机遵守公司 registry 访问限制，没有关闭 TLS 或绕路下载；包页面使用获准的 npmx，权威发布与安装验证在 GitHub-hosted runner 完成。

## D-AC03：从 npm 独立安装与运行

[首次真实 npm 消费者矩阵](https://github.com/shazhou-ww/potential-guide/actions/runs/38882670463) 五个 jobs 全通过，Ubuntu / macOS / Windows 三个消费者直接从 npm 安装全部八个确切 RC，不是 tarball、workspace 链接或源码 import。Node 22.13.0 / 24.11.1 的完整检查同时通过。

使用最终修订就绪 / 清理 harness 的[最终真实 npm 消费者矩阵](https://github.com/shazhou-ww/potential-guide/actions/runs/38884866502) 也已 **5 / 5 jobs 成功**，候选 commit 为 `2e585d52ee969eb610a779fc942c9524c49d6608`；其中三个 OS jobs 的 Verify published RC deployment 明确成功，两个 Node jobs 的完整检查成功。中途一次验证 run 38884617892 被后续 primary push 的 concurrency 规则取消，不计为成功；最终 run 在无并行 push 时完整完成。

独立消费者核实：已安装版本、内部依赖可解析、公开 exports / bins、无旧 Guide 产物；实际 Git URI / commit 规格加载、stdin subject、进程探针统一信封、完整 Agent 修复闭环、continue 真正 session/resume、持久化、保留期、脱敏、单次超时及旧预算参数拒绝。Unix runner 另验证真实 SIGTERM 取消；Windows 的进程 / HTTP 与运行句柄取消由对应运行测试覆盖，不将 Unix 信号断言冒充 Windows 验证。

Git ref 变化、旧快照稳定、来源错误、不同仓库的版本 / 检查归属、HTTP 本端取消不保证远端终止，以及依赖级替换 / 旧结果隔离均由同一产品源码的集成测试覆盖，见[实现验证](./inner/Validation.md)。不宣称任意 FRP 图已具备跨源事务语义。

迁移指导位于[消费方迁移文档](../../../../docs/functional-migration.md)。未修改 Silvermoon 仓库，不声称 Silvermoon 已完成迁移。用户委托主会话依据上述证据审批门线，最终生命周期状态须由精确 Outer revision 的 Submit / Accept 记录，不从此记录推断。
