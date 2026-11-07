# 多 Gateway 部署验证进展

## 当前状态与边界

实现 `implementationRevision=8387bae51149` 已在用户委托审批下接受；
原样 native Linux `pnpm check` 通过，70/70 工作区任务及 76/76 脚本测试，
详见 [实现证据](inner/Evidence.md)。本文件只记录部署阶段的实际观察，
不把实现测试、pin 元数据或单根块请求扩大成部署成功。

用户指定 Pinboard origin 为 `https://pinboard.shazhou.work`，允许使用已有 CID
只读验证；另明确同意本次自有只读 Node Gateway 作为备用，不要求第二个公共 Gateway。
用户说明另一个会话正在重建 Bundle，要求先等待。本会话不访问该会话工作目录，
不重复上传、不修改已有 publication、不发布 npm，也不连接远程机器。

## Pinboard 真实只读验证

2026-11-07，本会话在 Windows Node v24.12.0 下访问指定 origin：

- `GET /ipfs/{cid}?format=raw`，Accept 为 `application/vnd.ipld.raw`：
  实际返回 200、同一 MIME，无重定向。
- `GET /ipfs/bafkqaaa?format=raw` 返回 200、raw MIME、零字节，符合空 identity 探针。
- 实际 Engine `createIpfsGatewayClient` 成功读取并校验根及所有后继块；
  按 DAG-PB Links 递归，raw 叶不再展开，按 CID 去重，拒绝未知 codec。
- 为每个根遍历整个 DAG 后，以当前 `BundleCache({ prefetch: true })`
  继续验证 native Task Bundle 准入，未安装或调用 Kubo。

完整逐块清单、字节数、观察时间及每个准入错误见
[Pinboard 原始验证记录](verification/pinboard-probe.json)。

| 已有交付 | 根 CID | 验证块数 | 原始块字节合计 | 当前 Engine 准入 |
| --- | --- | --- | --- | --- |
| network | `bafybeigpnzao2lgpmx2ajfdu4w6uzzd3ovo7rf6gfrdv4dyuwwwepr6oca` | 16 | 23611 | `invalid_bundle` |
| directories | `bafybeihyo3ujmjh7jgtlfwmi6inowbcub4xdi2amj2m23rbv7ik3mzhdbi` | 15 | 19811 | `invalid_bundle` |
| tools | `bafybeieqcbsrb4xfnstoc5fmlhhjefyylpgruk4nfgk36kcuxf2mj6xota` | 17 | 22797 | `invalid_bundle` |

三个准入错误均为：

```text
Task Bundle has no exact binary manifest. Rebuild with the current Task Bundle authoring tools and use the new CID.
```

这证明指定 Pinboard 的真实 raw-block 与上述完整 DAG 可读取，
但这些旧 CID 不满足当前 Bundle 契约，不能用于声称 Check、重启恢复或切换验收通过。
不放宽 exact binary manifest、不绕过准入、不复用旧 CID 的名称代替内容身份。
普通 UnixFS 文件路径下载请求返回 404，CAR 请求返回 406；本流程只依赖实际已通过的
trustless raw-block 读取，不要求这两种未提供的能力。

## 等待的外部结果

等待其他会话通过用户或 primary 交付重建后的准确 Bundle CID；收到后先复核
当前契约准入与 Pinboard 完整 DAG，再按已同步的
[Deployment.md](Deployment.md) 运行独立 Linux/npm 消费、只读备用来源、
有界失败、取消、幂等与同 DB 重启恢复。
目前所有 D 项保持未勾选，未记录 submitOuter 或 acceptOuter。
