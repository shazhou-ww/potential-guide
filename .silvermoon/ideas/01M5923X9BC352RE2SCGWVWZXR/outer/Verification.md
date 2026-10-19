# P0 候选交付与发布边界

本记录支持 [Deployment.md](Deployment.md)，不表示已发布新 RC 或 latest。
实现由 subsession 完成；主会话独立审查、执行门限并按用户委托验收。

## 准确候选

- 产品和测试候选：`345027e47f4b530e66539bae822b51b2728e3427`。
- 已验收 Inner World：`a746f0c68279851dbe919eefa020cf0db02feeb4`，
  接受记录位于 primary `a0f4669d4bb6e63d39184266ac0ac6a55b851df3`。
- 本记录与后续账本、生命周期事件不修改已验证产品树。若 primary 合入其他
  产品更改，不能自动继承该候选的结果，必须重新核验相应门限。
- 六个新候选：objective-pilot `0.2.0-rc.0`；regulator / supervisor / pguide
  `0.4.0-rc.0`；cli-core / config `0.3.0-rc.0`。
  effects / git-source 保留 `0.1.0-rc.0`，不重复发布。
  API 分类、依赖顺序和未来稳定映射见
  [Release-candidates.md](inner/Release-candidates.md)。

## 主会话独立质量门禁

[CI 39230208150](https://github.com/shazhou-ww/potential-guide/actions/runs/39230208150)
的 headSha 与准确候选一致，五个 jobs 全部成功：

| 检查 | 结果 |
| --- | --- |
| Node 22.13.0 完整 pnpm check | success |
| Node 24.11.1 完整 pnpm check | success |
| Windows packed entry-only consumer | success |
| Ubuntu packed entry-only consumer | success |
| macOS packed entry-only consumer | success |

主会话自行触发、等待并核验此独立 validation ref；矩阵、断言和安装行为没有缩减。
该 ref 不是发布 tag，不触发 npm publishing。其他候选的取消和 4/5 成功不计作通过。
最终两种 Node 的完整 pnpm check 在 CI 执行，不声称本地 Windows 最后一轮
全量 pnpm check 已绿。

主会话本地独立回归 31/31，无失败、取消或跳过；另执行 setup 安全诊断与
ACP 拒绝 2/2，正式生成物 --check 成功。本地定向与完整 CI 共同覆盖默认和显式预算、实际取消、
owned 后代退出、Windows native PID/PPID 的 32/64 位 ABI 与句柄释放、
可信 Utility 导入、故障安全诊断及 entry-only 消费依赖图。
主会话再次断言八包 manifest 和所有内部 workspace:^；实际 pack 后范围及版本
由完整检查与三平台消费门限核验。详细过程保留于
[Implementation-evidence.md](inner/Implementation-evidence.md)。

## 当前 Outer 的最终本地消费门限

必须先把本部署契约与本记录同步至 primary，再由主会话在 Windows 执行：

```sh
pnpm deployment:verify
```

命令安装八包本地产物，但 consumer 顶层只依赖 pguide；内部 tarball overrides
仅用于解析尚未发布的候选。必须沿真实父包验证完整传递图、版本、范围、库导入、
CLI、ACP 调节和持久化恢复、retention / 脱敏、supervisor、授权与撤销。
真实安装产物的 Git 子目录 setup 必须以固定 revision、随机 nonce 修复、
独立最终 probe 达到 terminal；显式 subject 60000ms / process 75000ms，
不以 direct helper、预热或重试替代。默认预算、SSH 和 self-check 上限不扩大。

本记录在最终命令前同步，不能预记该命令成功。主会话必须检查真实退出码、完整
消费者输出以及本次 operation workspace / 子进程清理后，才勾选
[执行账本](../ledger.md) 的 D-S01 / D-AC01；实际命令和输出保留在主会话。
最终执行后只更新 idea 根账本和事件，不改 Outer 内容，使验收对应已验证的准确修订。

## 历史失败与纠正

旧候选 `0741d143e502c0918a563527c9a4663b29bb6ef1` 曾通过
[CI 39199404501](https://github.com/shazhou-ww/potential-guide/actions/runs/39199404501)，
但随后对 `9a05e479abb70d2274f3c79d8f1b2aec0f3e4e46` / Outer
`f13c8104a6d803dc3fbe60f7e765b06bf0d7a4ef` 的本地独立复验出现 setup 504。
旧成功未用于放行；Inner 已重新打开，补齐显式协调预算、资源回收与候选版本。
失败 operation `.cache/potential-guide-deployment-JaqshF` 已确认清理。

之后的本地完整检查暴露 direct 语义测试预算不足与 Windows 部分 taskkill；
CI 进一步暴露 Linux detached 后代真实泄漏和 Windows 快照 helper 阻塞。
这些失败与每次准确候选均保留在实现证据中，没有靠忽略活 PID、重试、
无限扩大时限或只看根进程退出取得绿灯。
Windows 最终使用系统原生 Toolhelp PID/PPID 快照及固定 helper 的可信模块显式导入，
仍受 10s watchdog 和原外层期限约束。新候选五项全部通过不反向证明
此前阻塞一定发生在 CIM provider。

## 尚未执行的真实发布

本 Idea 交付发布就绪候选，不是发布授权。既有 preset 继承及 release hold
没有解除；未创建发布 tag、未 npm publish、未移动 rc 或 latest，
未宣称新候选已存在于 registry。

解除 hold 并另行获得发布授权后：

1. 重新查询 registry dist-tags、精确版本和上游可用性，不沿用历史查询。
2. 按 effects 既有上游 → objective-pilot / git-source，
   objective-regulator → objective-portfolio-supervisor，
   cli-core → config，最后 pguide 的依赖关系，使用
   [npm 发布流程](../../../../docs/npm-publishing.md) 中的逐包 RC tag。
   只发布六个新候选，不重复发布两个未变上游、不重用已推送 tag。
3. 新 RC 全部发布后执行准确版本 registry 消费者：

   ```sh
   gh workflow run ci.yaml --ref main -f published=true
   ```

4. 稳定版需另行更新并核验所有被提升包的 manifest、pack 依赖范围与依赖顺序，
   检查和发布后再执行默认消费者：

   ```sh
   gh workflow run ci.yaml --ref main -f latest=true
   ```

--published 与 --latest 互斥，均只从 registry 安装 pguide、无本地 overrides，
并验证实际传递版本；后者另要求 pguide@latest 等于当前入口 manifest。
缺失版本必须明确失败，不回退旧包。本地 packed 成功不证明 registry 依赖可获取、
OIDC provenance 或默认 latest 安装成功；这些外部结果留待真实发布阶段验证。
