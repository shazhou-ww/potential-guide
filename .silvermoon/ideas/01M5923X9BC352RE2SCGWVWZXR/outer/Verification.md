# P0 候选交付与发布边界

本记录支持 [Deployment.md](Deployment.md)，不表示已发布新 RC 或 latest。
主会话负责所有检查与门限；实现由 subsession 完成，CI 暴露的问题也已重新实施和验收。

## 已验收的候选

- 最终产品和测试候选：`0741d143e502c0918a563527c9a4663b29bb6ef1`。
- 最终 Inner World：`59dc6c40689bfb2e1af1e3988747278de7968cee`，
  接受记录位于 primary `b183fbcbcc3efa023053563839d13ab0bc5f508e`。
- 后续文档和生命周期事件不改变 packages / scripts / objectives / .github 的已验证树。
- 五个已变包准备新候选：regulator / supervisor / pguide 为 `0.4.0-rc.0`，
  cli-core / config 为 `0.3.0-rc.0`；其他三个上游仍为 `0.1.0-rc.0`。
  逐包 API 分类、依赖顺序和稳定映射见
  [Release-candidates.md](inner/Release-candidates.md)。

## 独立检查与跨平台证据

主会话最终本地 pnpm check 完整成功，CLI 为 79 项、78 通过、0 失败和取消、
1 个既有平台跳过；包含格式、lint、类型、全部测试和八包 pack 检查。
具体历史失败和回归复验保留在
[Implementation-evidence.md](inner/Implementation-evidence.md)，不隐藏失败运行。

[CI 39199404501](https://github.com/shazhou-ww/potential-guide/actions/runs/39199404501)
在上述准确候选上五个 jobs 全部成功：

| 检查 | 结果 |
| --- | --- |
| Node 22.13.0 pnpm check | success |
| Node 24.11.1 pnpm check | success |
| Windows packed entry-only consumer | success |
| Ubuntu packed entry-only consumer | success |
| macOS packed entry-only consumer | success |

main 被其他会话频繁推送文档，CI 多次被 concurrency 规则取消；取消不计作成功。
本次以同一候选的独立 validation ref 调用已有 CI，矩阵、断言与安装行为没有缩减。
该 ref 不是发布 tag，不触发 npm publishing。

## 本地独立消费者

主会话在先前已同步契约上执行 pnpm deployment:verify 成功：
八包打包，只把 pguide 作为顶层依赖；本地内部 tarball overrides 解析其传递依赖。
检查真实父包的版本与范围、库导入、CLI 命令、ACP 完整调节及持久化和 session 恢复、
retention / 脱敏、supervisor 生命周期、固定 Git 子目录 setup 的随机 nonce 修复，
以及拒绝、continue 授权与撤销。不是 workspace 链接或源码导入。

该次操作目录 `.cache/potential-guide-deployment-3wO1jW` 在返回后不存在，
消费者清理成功。此后产品代码未改变，只修正测试的真实时钟假设。
本记录同步后，主会话再对稳定 Outer World 重跑相同命令，
检查独立目录被清理，并仅在根 ledger 记录最终结果，避免验证后改写此修订。

## 尚未执行的真实发布

本 Idea 的交付是发布就绪候选，不是发布授权。既有 preset 继承及 release hold
没有在本 Idea 中解除；未创建发布 tag、未 npm publish、未移动 rc 或 latest，
也没有宣称新候选已存在于 registry。

解除 hold 并另行获得发布授权后：

1. 复核 registry 当前 dist-tags、精确版本及上游可用性，不沿用历史查询作实时证明。
2. 按 regulator → supervisor、cli-core → config、最后 pguide 的依赖顺序，
   使用 [npm 发布流程](../../../../docs/npm-publishing.md) 中的逐包 RC tag。
   不重复发布三个未变上游，不重用已推送 tag。
3. 新 RC 全部发布后执行精确版本消费者：

   ```sh
   gh workflow run ci.yaml --ref main -f published=true
   ```

4. 稳定版需另行按清单更新全部将提升包的 manifest 和内部打包范围，
   重新检查并按依赖顺序发布；之后执行默认消费者：

   ```sh
   gh workflow run ci.yaml --ref main -f latest=true
   ```

`--published` 和 `--latest` 均只从 registry 安装 pguide，不使用本地 overrides，
并检查所有实际传递版本。后者另要求 pguide@latest 等于当前入口 manifest；
两种模式互斥，无版本时明确失败，不回退旧包。
本地 packed 成功不证明 registry 依赖解析、OIDC provenance 或默认 latest 安装成功；
这些外部动作明确留待实际发布阶段。
