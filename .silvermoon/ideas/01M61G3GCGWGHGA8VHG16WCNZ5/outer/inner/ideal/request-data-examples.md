# 关键数据结构：完整 Before / After 示例

本文是 [Request 生命周期修订](./request-lifecycle-revision.md) 的配套示例，
只列发生变化的数据结构，不重复未修改的 Artifact、业务结果或 Reference 契约。

## 阅读约定

- **Before** 对照 `127666e4ec04` 的实际类型，不把新字段塞进旧协议。
- 新方案是全新、不兼容设计；Before 仅解释变化，不构成兼容、迁移或旧别名承诺。
- **After 全部是待评审草案，不是当前接口或已发布 schema。** 为便于读完整对象，
  本文暂选具体字段名、状态值和错误码；这些选择不代表已确认。
- 每个 JSON 块都是该场景的完整对象，无省略号、伪注释、变量替换或“同上”对象。
  可选且该状态尚不存在的字段不输出，例如初始响应没有 artifact/result/execution。
  “完整例子”不表示把所有互斥状态的字段同时塞入一个对象。
- 字段暂沿用现有 camelCase，概念 `eligible_at/received_at/series_id`
  分别写成 `eligibleAt/receivedAt/seriesId`。PENDING 暂序列化为 `pending`。
  `acceptedAt → receivedAt` 是草案命名建议，不暗示旧字段已改名。
- 周期任务的顶层字段统一为 `recurrence`，与现有 Coordinator 命名一致。
  Before 保留现有子结构，After 展示双锚点扩展；同名不表示新旧协议语义完全相同。
  `recurrence` 的子结构暂用 `{periodMs, anchor}`；服务配置中的准备策略暂用
  `preparationPolicy: {leadMs, fallback}`，fallback 候选值为
  `none | previous-usable`。具体字段名仍待评审，默认不预取、不回退已确认；
  Request 不再携带 preparationPolicy。
- After 的 freshness 暂用 `started-after-eligible | completed-after-eligible`，
  准确表达 eligible 边界；不要求兼容旧 `*-after-request` 字面值。
- Request ID 已确认为幂等 ID，Task ID 由服务端独立分配；
  解析/准入失败可能不产生 Task。示例的 requestId 对应 `Idempotency-Key`，
  **所有 After 创建输入 JSON 均为完整 Request 实体，必须包含 requestId。**
  HTTP 序列化时把该字段放入 header，其余字段构成 body；收到后还原同一个实体。
  首个 Task 的默认 seriesId 为 taskId，后继继承 series。
  Request/Task/Series/Execution/Observation/Invocation/Host instance 等生成型身份
  统一为规范大写 ULID。作者定义的 levelId、problemId、局部 Checker 名称保留可读值；
  digest 和 revision 不叫 ID，也不使用 ULID。ULID 时间部分不裁定调度或授权。
  Before 的合成 ID 值也采用 ULID 方便对照，但不据此改变旧结构的字段。
  ID、URL、摘要和时间均为合成数据，
  摘要满足格式但不表示存在可下载的真实制品。
- 本文不发明 Regulation HTTP 服务：第 2 节将现有 Coordinator 调用输入
  与建议的统一 Regulation admission 输入对照，未规定新的 HTTP endpoint。
  内部持久记录不是调用方 Request，也不是公开 HTTP response。
- eligible 前的提前下载用 `prefetch` 展示，Task 仍 pending；正式 `preparation`
  必须在 eligible 后。`recurrence.anchor` 使用 eligible/terminated；
  Task 终结时间写 `terminatedAt`，保留 completed/failed/cancelled 状态及错误原因。

## Request 实体与 HTTP 传输的对应

第 1、2、5 节及超时后继例中的 After JSON 都是 Request 实体；
其中 requestId 不是可选日志标签，而是实体必需的幂等身份。
审计可在 Task 产生之前记录这个身份；业务 JSON 解析失败也用它返回错误。
下面列出各调用的 header 值，与相应实体/响应中的 requestId 一致：

| 场景 | HTTP `Idempotency-Key` |
|---|---|
| 1.1 Check 首轮 | `01M60000000000000000000002` |
| 1.2 Probe 首轮 | `01M60000000000000000000018` |
| 1.3 过去 eligible 的单次 Check | `01M60000000000000000000016` |
| 1.4 解析/准入错误 | `01M6000000000000000000000F` |
| 2 Regulation 调用身份（进程内使用同一 requestId） | `01M6000000000000000000001C` |
| 4.5 超时后继 | `01M60000000000000000000012` |
| 5.1 Check 后继 | `01M60000000000000000000003` |
| 5.1 Probe 后继 | `01M60000000000000000000019` |

Before 的 HTTP body 本来不包含 requestId，header 也使用表中相应合成值；
Coordinator Before 使用自身 requestRef，并不是一条 HTTP 调用。
后继由服务内部生成时也必须创建完整 Request 实体；不要求先绕 HTTP 才有身份。

以下完整 HTTP 例对应第 1.1 的同一个 Request。`/checks` 只是示例挂载点，
省略与此设计无关的鉴权凭据；实体序列化时仅取出 requestId 放入 header，
body 保留其他字段，不同时提供第二份 requestId：

```http
POST /checks/check-tasks HTTP/1.1
Host: 127.0.0.1:8080
Content-Type: application/json
Idempotency-Key: 01M60000000000000000000002

{
  "checker": {
    "url": "https://example.test/checker/latest.tgz"
  },
  "subject": {
    "root": "D:\\project"
  },
  "context": {},
  "language": "en",
  "freshness": "completed-after-eligible",
  "timeoutMs": 30000,
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "seriesId": "01M6000000000000000000001D",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "eligible"
  }
}
```

服务先识别合法 ULID header，再尝试解析 body 并还原实体。即使 body 是无效 JSON，
也可返回下面的关联错误，不需要生成 Task 或默认 series：

```json
{
  "requestId": "01M6000000000000000000000F",
  "error": {
    "code": "invalid_json",
    "stage": "validate",
    "message": "Invalid JSON body."
  }
}
```

缺失或非法 header 是请求身份错误，不假造一个合法 requestId 冒充客户端原请求。
所有生成型身份都是示例 ULID，不用其编码时间推断收到请求、eligible 或实际执行时间。

## 0. 服务配置：preparation policy 不属于 Request

**Before：** 当前 `createUnifiedServices` 的完整配置对象。
服务现在接收 Task 后立即准备，没有独立 eligible 预取策略。

```json
{
  "directory": "D:\\service-cache",
  "allowedOrigins": [
    "https://example.test"
  ],
  "languages": [
    "en"
  ]
}
```

**After：** 服务显式启用提前 10 秒预取及浮动来源的旧版回退；
以下需要预取/fallback 的 Task 示例均在此服务配置下发生，不是请求自带这些参数。
字段布局是草案，不能直接传给当前 API。

```json
{
  "directory": "D:\\service-cache",
  "allowedOrigins": [
    "https://example.test"
  ],
  "languages": [
    "en"
  ],
  "preparationPolicy": {
    "leadMs": 10000,
    "fallback": "previous-usable"
  }
}
```

新模型未提供 preparationPolicy 时，不预取也不回退：
Task 在 eligible 后才正式开始选版、下载和验证。只配置预取不代表开启 fallback。
服务即使允许 previous-usable，也不能替换请求的显式 digest 或制品内固定的 Checker，
不能用另一版本掩盖业务不通过；实际回退仍须记录准确版本和更新错误。

## 1. Check / Probe 创建 Request

### 1.1 Check：浮动来源、未来 eligible、按 eligible 递归

**Before：** 当前 Checker v3 创建请求。它没有 eligible、series、recurrence 或准备策略。

```json
{
  "checker": {
    "url": "https://example.test/checker/latest.tgz"
  },
  "subject": {
    "root": "D:\\project"
  },
  "context": {},
  "language": "en",
  "freshness": "completed-after-request",
  "timeoutMs": 30000
}
```

**After：** 接收于 03:20:00Z，03:21:00Z 才 eligible，提前 10 秒准备。
周期与服务准备提前量相互独立；输入 series 由调用方显式指定。

```json
{
  "requestId": "01M60000000000000000000002",
  "checker": {
    "url": "https://example.test/checker/latest.tgz"
  },
  "subject": {
    "root": "D:\\project"
  },
  "context": {},
  "language": "en",
  "freshness": "completed-after-eligible",
  "timeoutMs": 30000,
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "seriesId": "01M6000000000000000000001D",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "eligible"
  }
}
```

### 1.2 Probe：准确来源、按 terminated 递归

**Before：** 当前 Objective v1 请求，bindings 显式固定根版本。

```json
{
  "objective": {
    "url": "https://example.test/objective/v1.tgz",
    "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "subject": {
    "root": "D:\\project"
  },
  "context": {},
  "language": "en",
  "bindings": {
    "https://example.test/objective/v1.tgz": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "freshness": "started-after-request",
  "timeoutMs": 60000
}
```

**After：** 省略 eligible 和 series，服务端默认补齐；本轮正常完成、失败或超时后
再等待 60 秒。取消 pending 不产生后继。
显式 digest 不允许换成另一旧版，即使服务启用 fallback 也不能替换。
普通 Probe 删除重复根绑定，静态 Checker 版本已由 Objective 的 Merkle DAG 固定。
每个后继仍继承此准确引用，
不是所有 recurrence 请求都会升级制品；只有浮动来源才重新选版。

```json
{
  "requestId": "01M60000000000000000000018",
  "objective": {
    "url": "https://example.test/objective/v1.tgz",
    "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "subject": {
    "root": "D:\\project"
  },
  "context": {},
  "language": "en",
  "freshness": "started-after-eligible",
  "timeoutMs": 60000,
  "recurrence": {
    "periodMs": 60000,
    "anchor": "terminated"
  }
}
```

`targetLevel: "initial"` 仍是可选的单次输入验证能力；本例执行完整观察所以不传，
不以 recurrence 模式改变其业务含义。
运行时提出的其他 Objective 不一定属于上述静态 DAG，服务仍须记录其实际 digest；
普通请求不必重复提供它们。是否提供独立 `dependencyBindings` 输入尚待讨论，
本例不把旧 bindings 机械改名为新的必填参数。

### 1.3 非递归 Request：eligible 可以早于接收

**Before：**

```json
{
  "checker": {
    "url": "https://example.test/checker/v1.tgz",
    "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "subject": {},
  "freshness": "completed-after-request",
  "timeoutMs": 30000
}
```

**After：** 若 03:20:00Z 收到，只剩 20 秒预算；可匹配符合 03:19:50Z 边界的保留结果。
recurrence 未提供，任务不会自动产生后继。

```json
{
  "requestId": "01M60000000000000000000016",
  "checker": {
    "url": "https://example.test/checker/v1.tgz",
    "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "subject": {},
  "freshness": "completed-after-eligible",
  "timeoutMs": 30000,
  "eligibleAt": "2026-10-29T03:19:50.000Z"
}
```

### 1.4 Request 解析失败：没有 Task

此场景调用带 `Idempotency-Key: 01M6000000000000000000000F`，来源不是允许的 HTTPS 地址。
Before 已返回结构化错误；After 建议同时返回幂等 Request ID，便于关联失败调用。
两侧均为 HTTP 400，After 不分配 taskId，也不能用 requestId 伪造默认 seriesId。
失败 Request 的保留期限和重试细节尚未在本例中规定。

**Before：**

```json
{
  "error": {
    "code": "invalid_source",
    "stage": "resolve",
    "message": "Expected authorized HTTPS source and optional Git SHA-256 digest."
  }
}
```

**After：**

```json
{
  "requestId": "01M6000000000000000000000F",
  "error": {
    "code": "invalid_source",
    "stage": "resolve",
    "message": "Expected authorized HTTPS source and optional Git SHA-256 digest."
  }
}
```

## 2. Regulation：与 Check / Probe 同层次的调用 Request

此前这里展示的是 `RegulationRequest` 内部存储元素，与第 1 节的创建输入层次不同。
现改为实际 `RequestCommand` 的完整 Before，再展示新的调用方 admission 形状；
不再把 targetKey、objectiveRevisionKey 误当作用户应提交的 Objective 描述。

**Before：** 当前 Coordinator `RequestCommand` 要求调用方先构造完整 PilotSpec。
以下给出整个输入，包含已解析的 Objective 定义、页面及准确来源，
不是用空对象或数据库 key 代替原先必需的内容。

```json
{
  "type": "request",
  "requestRef": "01M6000000000000000000001C",
  "objective": {
    "objectiveId": "objective:https://example.test/objective/v1.tgz",
    "version": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "source": {
      "kind": "artifact-service-v1",
      "url": "https://example.test/objective/v1.tgz",
      "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "environment": {
        "type": "node",
        "version": "24.11.1",
        "platform": "win32",
        "architecture": "x64",
        "adapter": "node-commonjs-v1",
        "configuration": "{\"cleanupMs\":5000,\"deadlineMs\":30000,\"directories\":64,\"messageBytes\":8388608,\"observers\":64,\"queue\":64,\"records\":256,\"retentionMs\":60000,\"retireAfter\":100,\"workers\":4}"
      },
      "bindings": {}
    },
    "manifest": {
      "$schema": "https://shazhou-ww.github.io/potential-guide/schemas/objective/v3.json",
      "subjectSchema": {
        "type": "object"
      },
      "levels": [
        {
          "id": "ready",
          "checks": [
            {
              "id": "pass",
              "problems": []
            }
          ]
        }
      ],
      "defaultLanguage": "en",
      "languages": [
        "en"
      ]
    },
    "locales": {
      "en": {
        "objective": {
          "id": "objective",
          "title": "Objective",
          "description": "Synthetic Objective guidance.",
          "references": [],
          "content": "Observe the workspace.",
          "origin": {
            "artifactDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "path": "references/en/objective.md"
          }
        },
        "levels/ready": {
          "id": "levels/ready",
          "title": "Ready",
          "description": "Synthetic level guidance.",
          "references": [],
          "content": "The workspace passes its check.",
          "origin": {
            "artifactDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "path": "references/en/levels/ready.md"
          }
        },
        "checkers/pass": {
          "id": "checkers/pass",
          "title": "Checker",
          "description": "Synthetic Checker guidance.",
          "references": [],
          "content": "Check the workspace.",
          "origin": {
            "artifactDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "path": "references/en/checker.md"
          }
        },
        "pages/base-pass": {
          "id": "pages/base-pass",
          "title": "Checker",
          "description": "Synthetic Checker guidance.",
          "references": [],
          "content": "Check the workspace.",
          "origin": {
            "artifactDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "path": "references/en/checker.md"
          }
        }
      }
    }
  },
  "subject": {
    "root": "D:\\project"
  },
  "desiredLevel": "terminal",
  "priority": 1,
  "origin": {
    "kind": "external"
  },
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "recurrence": {
    "intervalMs": 60000
  }
}
```

**After：** 与 Probe 使用相同的 `objective: {url, digest?}`，与 Check 的
`checker: {url, digest?}` 对称。subject 直接表达治理对象，desiredLevel 与 priority
保留治理需求的差异。默认 series/eligible 与其他 Task 一致，例中显式给出以便对照。
幂等 Request ID `01M6000000000000000000001C` 是实体的 requestId，与 Check/Probe 的 request ID 同义。
若通过 HTTP 传输，它进入 header 而不重复写入 body；进程内接口直接接收完整实体。
它不是内部 requestRef、Task ID 或运行时 evidence。

```json
{
  "requestId": "01M6000000000000000000001C",
  "objective": {
    "url": "https://example.test/objective/v1.tgz",
    "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "subject": {
    "root": "D:\\project"
  },
  "context": {},
  "language": "en",
  "desiredLevel": "terminal",
  "priority": 1,
  "seriesId": "01M6000000000000000000001E",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "freshness": "completed-after-eligible",
  "timeoutMs": 300000,
  "recurrence": {
    "periodMs": 60000,
    "anchor": "eligible"
  }
}
```

未提供 digest 时，由服务按准备配置选择浮动来源；提供 digest 时必须准确匹配。
没有要求调用方重复传 manifest、locales、静态 Checker bindings 或 runtime 证据。
服务解析出准确内容后，才在内部构造 PilotSpec、targetKey、objectiveRevisionKey
以及 Coordinator 的 request fact；这些存储表示不必机械改为公开 Request 的形状。
外部 origin 由受理入口标识，内部依赖/周期产生的 origin 由服务记录，不让外部伪造。

这里的 timeout 是 Task 期限，不是 Agent execution limit 或治理 quota 的静默重命名；
freshness 也不意味着可随意共享有副作用的 Agent 执行。新统一字段向 Coordinator 的
预算与调度映射仍须专门设计，不以 Objective 引用对称推定执行策略也完全相同。
本次不新增 Regulation HTTP listener；新设计不需要兼容现有 RequestCommand 或旧持久 schema。

## 3. 创建 Response：完整初始 Task 快照

### 3.1 Check 创建响应：accepted → pending

Before 的 POST 成功返回 HTTP 201、Location 和快照本身，没有额外 `{task: ...}` 包装。
After 采用快照响应；新路由独立设计，不承担旧 endpoint 的兼容义务。
本例调用的 `Idempotency-Key: 01M60000000000000000000002` 就是响应中的 requestId。

**Before：**

```json
{
  "taskId": "01M60000000000000000000006",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 1,
  "state": "accepted",
  "acceptedAt": "2026-10-29T03:20:00.000Z",
  "freshness": "completed-after-request"
}
```

**After：** 对应 1.1 的 Request。pending 时没有 Execution；
scheduledAt 为 eligible 减去准备提前量，而不是 received。

```json
{
  "taskId": "01M60000000000000000000006",
  "requestId": "01M60000000000000000000002",
  "seriesId": "01M6000000000000000000001D",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 1,
  "state": "pending",
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "deadlineAt": "2026-10-29T03:21:30.000Z",
  "freshness": "completed-after-eligible",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "prefetch": {
    "state": "scheduled",
    "scheduledAt": "2026-10-29T03:20:50.000Z"
  }
}
```

### 3.2 Probe 创建响应：默认 series 和 eligible

**Before：**

```json
{
  "taskId": "01M6000000000000000000001A",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 1,
  "state": "accepted",
  "acceptedAt": "2026-10-29T03:20:00.000Z",
  "freshness": "started-after-request"
}
```

**After：** 对应 1.2，调用使用 `Idempotency-Key: 01M60000000000000000000018`；
series 等于独立分配的 Task ID，eligible 等于 received。
计算出的准备时间早于接收，只能接收后立即安排，不伪造提前发生的下载。

```json
{
  "taskId": "01M6000000000000000000001A",
  "requestId": "01M60000000000000000000018",
  "seriesId": "01M6000000000000000000001A",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 1,
  "state": "pending",
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:20:00.000Z",
  "deadlineAt": "2026-10-29T03:21:00.000Z",
  "freshness": "started-after-eligible",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "terminated"
  },
  "prefetch": {
    "state": "scheduled",
    "scheduledAt": "2026-10-29T03:20:00.000Z"
  }
}
```

## 4. 准备/回退及完成 Response

### 4.1 更新失败：正式准备失败与提前预优化失败

同一浮动来源更新下载失败，Before 没有 fallback；After 假定此前已有符合授权的准确旧版，
服务明确允许回退。若旧版不存在或不再可用，正式准备仍必须失败。

**Before：**

```json
{
  "taskId": "01M60000000000000000000006",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 3,
  "state": "failed",
  "acceptedAt": "2026-10-29T03:20:00.000Z",
  "freshness": "completed-after-request",
  "error": {
    "code": "download_failed",
    "stage": "download",
    "message": "Artifact download failed."
  }
}
```

**After：** 03:20:52Z 预优化找到回退候选，尚未 eligible，因此仍 pending；
准确旧版的选择来源与更新失败均可观察，没有顶层 failed error 冒充运行失败。
selectedCandidate 是预优化候选，尚未完成正式 PREPARING 准入；
该阶段失败不直接终结 Task，eligible 后正式准备再做准入决定。

```json
{
  "taskId": "01M60000000000000000000006",
  "requestId": "01M60000000000000000000002",
  "seriesId": "01M6000000000000000000001D",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 3,
  "state": "pending",
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "deadlineAt": "2026-10-29T03:21:30.000Z",
  "freshness": "completed-after-eligible",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "prefetch": {
    "state": "fallback",
    "scheduledAt": "2026-10-29T03:20:50.000Z",
    "startedAt": "2026-10-29T03:20:50.000Z",
    "completedAt": "2026-10-29T03:20:52.000Z",
    "selectedCandidate": {
      "kind": "checker",
      "url": "https://example.test/checker/latest.tgz",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "fallbackFromTaskId": "01M60000000000000000000005",
    "updateError": {
      "code": "download_failed",
      "stage": "download",
      "message": "Artifact download failed."
    }
  }
}
```

### 4.2 Completed Check：时间、身份与选版证据随最终结果保留

本例给出完整 manifest、业务 payload 和执行环境，不用占位对象替代它们。
两侧为各自协议下的合成成功执行；Before 不是 4.1 那个失败 Task 的后续状态。
runtime.configuration 是现有协议中的规范 JSON 字符串，不改为对象。

**Before：**

```json
{
  "taskId": "01M60000000000000000000006",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 7,
  "state": "completed",
  "acceptedAt": "2026-10-29T03:20:00.000Z",
  "freshness": "completed-after-request",
  "artifact": {
    "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "source": "https://example.test/checker/latest.tgz",
    "checkedAt": "2026-10-29T03:20:01.000Z",
    "transportDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "manifest": {
      "$schema": "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/checker/v1.json",
      "runtime": {
        "type": "node",
        "minVersion": "22.13.0"
      },
      "entry": "checker.cjs",
      "subjectSchema": {
        "type": "object"
      },
      "problems": [],
      "languages": [
        "en"
      ]
    }
  },
  "language": "en",
  "executionId": "01M60000000000000000000001",
  "executionStartedAt": "2026-10-29T03:20:02.000Z",
  "executionCompletedAt": "2026-10-29T03:20:03.000Z",
  "result": {
    "ok": true,
    "problems": []
  },
  "evidence": {
    "runtime": {
      "type": "node",
      "version": "24.11.1",
      "platform": "win32",
      "architecture": "x64",
      "adapter": "node-commonjs-v1",
      "configuration": "{\"cleanupMs\":5000,\"deadlineMs\":30000,\"directories\":64,\"messageBytes\":8388608,\"observers\":64,\"queue\":64,\"records\":256,\"retentionMs\":60000,\"retireAfter\":100,\"workers\":4}"
    },
    "revision": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  }
}
```

**After：** Task 的 terminatedAt 与 Execution 完成时间分开；
旧内容的 checkedAt 保留原值，本次更新尝试保存在 prefetch 中，不冒充成功更新。
正式 preparation 在 eligible 后验证并采用旧候选。

```json
{
  "taskId": "01M60000000000000000000006",
  "requestId": "01M60000000000000000000002",
  "seriesId": "01M6000000000000000000001D",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 8,
  "state": "completed",
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "deadlineAt": "2026-10-29T03:21:30.000Z",
  "terminatedAt": "2026-10-29T03:21:04.010Z",
  "freshness": "completed-after-eligible",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "prefetch": {
    "state": "fallback",
    "scheduledAt": "2026-10-29T03:20:50.000Z",
    "startedAt": "2026-10-29T03:20:50.000Z",
    "completedAt": "2026-10-29T03:20:52.000Z",
    "selectedCandidate": {
      "kind": "checker",
      "url": "https://example.test/checker/latest.tgz",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "fallbackFromTaskId": "01M60000000000000000000005",
    "updateError": {
      "code": "download_failed",
      "stage": "download",
      "message": "Artifact download failed."
    }
  },
  "preparation": {
    "state": "ready",
    "startedAt": "2026-10-29T03:21:00.001Z",
    "completedAt": "2026-10-29T03:21:00.009Z",
    "selected": {
      "kind": "checker",
      "url": "https://example.test/checker/latest.tgz",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  },
  "artifact": {
    "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "source": "https://example.test/checker/latest.tgz",
    "checkedAt": "2026-10-29T03:19:00.000Z",
    "transportDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "manifest": {
      "$schema": "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/checker/v1.json",
      "runtime": {
        "type": "node",
        "minVersion": "22.13.0"
      },
      "entry": "checker.cjs",
      "subjectSchema": {
        "type": "object"
      },
      "problems": [],
      "languages": [
        "en"
      ]
    }
  },
  "language": "en",
  "executionId": "01M60000000000000000000001",
  "executionStartedAt": "2026-10-29T03:21:00.010Z",
  "executionCompletedAt": "2026-10-29T03:21:04.000Z",
  "result": {
    "ok": true,
    "problems": []
  },
  "evidence": {
    "runtime": {
      "type": "node",
      "version": "24.11.1",
      "platform": "win32",
      "architecture": "x64",
      "adapter": "node-commonjs-v1",
      "configuration": "{\"cleanupMs\":5000,\"deadlineMs\":30000,\"directories\":64,\"messageBytes\":8388608,\"observers\":64,\"queue\":64,\"records\":256,\"retentionMs\":60000,\"retireAfter\":100,\"workers\":4}"
    },
    "revision": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  }
}
```

### 4.3 Completed Probe：完整组合结果与嵌套子 Task

独立场景：一个 Objective 调用一个 Checker，全部通过。两侧完整展开
result、progress、evidence.checks[].snapshot，展示公共快照改动也进入嵌套证据。
子 Check 是本次组合观察的一次性需求，不自动继承根 Probe 的递归策略或 series；
其归属通过 invocation 和父观察关系表达。
结果和 evidence 中的 bindings 是服务生成的准确观察记录，保留现有结果形状，
不是要求调用方在普通 Probe Request 中再提供一份输入。动态依赖的记录仍然必要，
而其公开输入能力与恢复时是否传回绑定另议。

**Before：**

```json
{
  "taskId": "01M6000000000000000000001A",
  "hostInstance": "01M60000000000000000000014",
  "revision": 16,
  "state": "completed",
  "acceptedAt": "2026-10-29T03:20:00.000Z",
  "freshness": "started-after-request",
  "artifact": {
    "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "source": "https://example.test/objective/v1.tgz",
    "checkedAt": "2026-10-29T03:20:00.100Z",
    "manifest": {
      "$schema": "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/objective/v1.json",
      "subjectSchema": {
        "type": "object"
      },
      "languages": [
        "en"
      ],
      "levels": [
        {
          "id": "ready",
          "checks": [
            "pass"
          ]
        }
      ],
      "checkers": {
        "pass": {
          "url": "https://example.test/checker/v1.tgz",
          "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "subjectMapping": "$"
        }
      }
    }
  },
  "language": "en",
  "executionId": "01M60000000000000000000017",
  "executionStartedAt": "2026-10-29T03:20:00.200Z",
  "executionCompletedAt": "2026-10-29T03:20:01.100Z",
  "result": {
    "current": {
      "objective": {
        "kind": "objective",
        "url": "https://example.test/objective/v1.tgz",
        "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      },
      "levelId": "ready"
    },
    "problems": [],
    "gapSummary": "",
    "observedAt": "2026-10-29T03:20:01.090Z",
    "bindings": {
      "https://example.test/objective/v1.tgz": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  },
  "progress": {
    "observations": [
      {
        "id": "01M60000000000000000000015",
        "objective": {
          "kind": "objective",
          "url": "https://example.test/objective/v1.tgz",
          "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        },
        "currentLevel": "ready",
        "attainedLevel": "ready",
        "levels": [
          {
            "id": "ready",
            "state": "passed"
          }
        ]
      }
    ],
    "invocations": [
      {
        "id": "01M60000000000000000000010",
        "observationId": "01M60000000000000000000015",
        "objective": {
          "kind": "objective",
          "url": "https://example.test/objective/v1.tgz",
          "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        },
        "level": "ready",
        "checker": "pass",
        "taskId": "01M6000000000000000000000C",
        "executionId": "01M6000000000000000000000A",
        "state": "completed"
      }
    ]
  },
  "evidence": {
    "bindings": {
      "https://example.test/objective/v1.tgz": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    "checks": [
      {
        "invocationId": "01M60000000000000000000010",
        "snapshot": {
          "taskId": "01M6000000000000000000000C",
          "hostInstance": "01M60000000000000000000009",
          "revision": 7,
          "state": "completed",
          "acceptedAt": "2026-10-29T03:20:00.210Z",
          "freshness": "started-after-request",
          "artifact": {
            "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "source": "https://example.test/checker/v1.tgz",
            "checkedAt": "2026-10-29T03:20:00.150Z",
            "manifest": {
              "$schema": "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/checker/v1.json",
              "runtime": {
                "type": "node",
                "minVersion": "22.13.0"
              },
              "entry": "checker.cjs",
              "subjectSchema": {
                "type": "object"
              },
              "problems": [],
              "languages": [
                "en"
              ]
            }
          },
          "language": "en",
          "executionId": "01M6000000000000000000000A",
          "executionStartedAt": "2026-10-29T03:20:00.300Z",
          "executionCompletedAt": "2026-10-29T03:20:01.000Z",
          "result": {
            "ok": true,
            "problems": []
          },
          "evidence": {
            "runtime": {
              "type": "node",
              "version": "24.11.1",
              "platform": "win32",
              "architecture": "x64",
              "adapter": "node-commonjs-v1",
              "configuration": "{\"cleanupMs\":5000,\"deadlineMs\":30000,\"directories\":64,\"messageBytes\":8388608,\"observers\":64,\"queue\":64,\"records\":256,\"retentionMs\":60000,\"retireAfter\":100,\"workers\":4}"
            },
            "revision": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
          }
        }
      }
    ]
  }
}
```

**After：** 根是 terminated 锚点递归，child 不递归。根 Task.terminatedAt
比 Execution.completedAt 晚 10ms，下一轮锚定前者；子 series 默认等于子 Task ID。
该例的 child 在父执行开始之后才受理，其 eligible 默认等于自身 received。
这里展示两个逻辑服务同机装配的时间，不用客户端时间跨远端服务仲裁。

```json
{
  "taskId": "01M6000000000000000000001A",
  "requestId": "01M60000000000000000000018",
  "seriesId": "01M6000000000000000000001A",
  "hostInstance": "01M60000000000000000000014",
  "revision": 18,
  "state": "completed",
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:20:00.000Z",
  "deadlineAt": "2026-10-29T03:21:00.000Z",
  "terminatedAt": "2026-10-29T03:20:01.110Z",
  "freshness": "started-after-eligible",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "terminated"
  },
  "preparation": {
    "state": "ready",
    "scheduledAt": "2026-10-29T03:20:00.000Z",
    "startedAt": "2026-10-29T03:20:00.010Z",
    "completedAt": "2026-10-29T03:20:00.180Z",
    "selected": {
      "kind": "objective",
      "url": "https://example.test/objective/v1.tgz",
      "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  },
  "artifact": {
    "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "source": "https://example.test/objective/v1.tgz",
    "checkedAt": "2026-10-29T03:20:00.100Z",
    "manifest": {
      "$schema": "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/objective/v1.json",
      "subjectSchema": {
        "type": "object"
      },
      "languages": [
        "en"
      ],
      "levels": [
        {
          "id": "ready",
          "checks": [
            "pass"
          ]
        }
      ],
      "checkers": {
        "pass": {
          "url": "https://example.test/checker/v1.tgz",
          "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "subjectMapping": "$"
        }
      }
    }
  },
  "language": "en",
  "executionId": "01M60000000000000000000017",
  "executionStartedAt": "2026-10-29T03:20:00.200Z",
  "executionCompletedAt": "2026-10-29T03:20:01.100Z",
  "result": {
    "current": {
      "objective": {
        "kind": "objective",
        "url": "https://example.test/objective/v1.tgz",
        "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      },
      "levelId": "ready"
    },
    "problems": [],
    "gapSummary": "",
    "observedAt": "2026-10-29T03:20:01.090Z",
    "bindings": {
      "https://example.test/objective/v1.tgz": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  },
  "progress": {
    "observations": [
      {
        "id": "01M60000000000000000000015",
        "objective": {
          "kind": "objective",
          "url": "https://example.test/objective/v1.tgz",
          "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        },
        "currentLevel": "ready",
        "attainedLevel": "ready",
        "levels": [
          {
            "id": "ready",
            "state": "passed"
          }
        ]
      }
    ],
    "invocations": [
      {
        "id": "01M60000000000000000000010",
        "observationId": "01M60000000000000000000015",
        "objective": {
          "kind": "objective",
          "url": "https://example.test/objective/v1.tgz",
          "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        },
        "level": "ready",
        "checker": "pass",
        "taskId": "01M6000000000000000000000C",
        "executionId": "01M6000000000000000000000A",
        "state": "completed"
      }
    ]
  },
  "evidence": {
    "bindings": {
      "https://example.test/objective/v1.tgz": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    "checks": [
      {
        "invocationId": "01M60000000000000000000010",
        "snapshot": {
          "taskId": "01M6000000000000000000000C",
          "requestId": "01M6000000000000000000000B",
          "seriesId": "01M6000000000000000000000C",
          "hostInstance": "01M60000000000000000000009",
          "revision": 8,
          "state": "completed",
          "receivedAt": "2026-10-29T03:20:00.210Z",
          "eligibleAt": "2026-10-29T03:20:00.210Z",
          "deadlineAt": "2026-10-29T03:22:00.210Z",
          "terminatedAt": "2026-10-29T03:20:01.010Z",
          "freshness": "started-after-eligible",
          "preparation": {
            "state": "ready",
            "scheduledAt": "2026-10-29T03:20:00.210Z",
            "startedAt": "2026-10-29T03:20:00.220Z",
            "completedAt": "2026-10-29T03:20:00.250Z",
            "selected": {
              "kind": "checker",
              "url": "https://example.test/checker/v1.tgz",
              "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            }
          },
          "artifact": {
            "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "source": "https://example.test/checker/v1.tgz",
            "checkedAt": "2026-10-29T03:20:00.150Z",
            "manifest": {
              "$schema": "https://shazhou-ww.github.io/potential-guide/schemas/artifacts/checker/v1.json",
              "runtime": {
                "type": "node",
                "minVersion": "22.13.0"
              },
              "entry": "checker.cjs",
              "subjectSchema": {
                "type": "object"
              },
              "problems": [],
              "languages": [
                "en"
              ]
            }
          },
          "language": "en",
          "executionId": "01M6000000000000000000000A",
          "executionStartedAt": "2026-10-29T03:20:00.300Z",
          "executionCompletedAt": "2026-10-29T03:20:01.000Z",
          "result": {
            "ok": true,
            "problems": []
          },
          "evidence": {
            "runtime": {
              "type": "node",
              "version": "24.11.1",
              "platform": "win32",
              "architecture": "x64",
              "adapter": "node-commonjs-v1",
              "configuration": "{\"cleanupMs\":5000,\"deadlineMs\":30000,\"directories\":64,\"messageBytes\":8388608,\"observers\":64,\"queue\":64,\"records\":256,\"retentionMs\":60000,\"retireAfter\":100,\"workers\":4}"
            },
            "revision": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
          }
        }
      }
    ]
  }
}
```

### 4.4 正式 PREPARING：一定在 eligible 后

独立场景展示状态顺序：Before 接收后立即 preparing；
After 预优化可以很早开始，但 Task 到 03:21:00Z 才正式 preparing。
以下展示预优化未成功的分支，不假装已经有 artifact 或 execution。

**Before：**

```json
{
  "taskId": "01M60000000000000000000006",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 2,
  "state": "preparing",
  "acceptedAt": "2026-10-29T03:20:00.000Z",
  "freshness": "completed-after-request"
}
```

**After：**

```json
{
  "taskId": "01M60000000000000000000006",
  "requestId": "01M60000000000000000000002",
  "seriesId": "01M6000000000000000000001D",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 4,
  "state": "preparing",
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "deadlineAt": "2026-10-29T03:21:30.000Z",
  "freshness": "completed-after-eligible",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "prefetch": {
    "state": "failed",
    "scheduledAt": "2026-10-29T03:20:50.000Z",
    "startedAt": "2026-10-29T03:20:50.000Z",
    "completedAt": "2026-10-29T03:20:52.000Z",
    "error": {
      "code": "download_failed",
      "stage": "download",
      "message": "Artifact download failed."
    }
  },
  "preparation": {
    "state": "running",
    "startedAt": "2026-10-29T03:21:00.001Z"
  }
}
```

### 4.5 错过周期且已超时：只终结一个 Task，系列继续

Before 的 Check/Probe 无未来 pending 调度与递归，超时只返回单轮 failed。
After 示例中 Task 于 03:19:00Z 接收，eligible 为 03:20:00Z，
deadline 为 03:20:30Z，但直到 03:25:00Z 才处理；它只代表一个过期 Task，
不能补建 03:21/22/23/24Z 四个历史 Task，也不能重置该轮 timeout。

**Before：** 30 秒受理期限已过后的单轮失败。

```json
{
  "taskId": "01M60000000000000000000013",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 3,
  "state": "failed",
  "acceptedAt": "2026-10-29T03:19:00.000Z",
  "freshness": "completed-after-request",
  "error": {
    "code": "task_timeout",
    "stage": "schedule",
    "message": "Task deadline expired."
  }
}
```

**After：** 没有开始执行，terminatedAt 是实际裁定终结的服务端时间，
不是把 deadline 伪造为已发生的结束事件。Task 保留 failed/timeout 原因。

```json
{
  "taskId": "01M60000000000000000000013",
  "requestId": "01M60000000000000000000011",
  "seriesId": "01M60000000000000000000013",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 2,
  "state": "failed",
  "receivedAt": "2026-10-29T03:19:00.000Z",
  "eligibleAt": "2026-10-29T03:20:00.000Z",
  "deadlineAt": "2026-10-29T03:20:30.000Z",
  "terminatedAt": "2026-10-29T03:25:00.000Z",
  "freshness": "completed-after-eligible",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "terminated"
  },
  "error": {
    "code": "task_timeout",
    "stage": "schedule",
    "message": "Task deadline expired."
  }
}
```

此失败不停止系列。仅生成以下一个未来后继创建 Request，
使用新的幂等 ID `01M60000000000000000000012`，成功后分配新的 Task ID并继承 `01M60000000000000000000013` 系列。
本例采用 terminated 锚点，03:25:00Z 加 60 秒得到 03:26:00Z；
eligible 锚点错过周期后如何选择未来点，仍留待下一轮讨论。

```json
{
  "requestId": "01M60000000000000000000012",
  "checker": {
    "url": "https://example.test/checker/latest.tgz"
  },
  "subject": {},
  "freshness": "completed-after-eligible",
  "timeoutMs": 30000,
  "eligibleAt": "2026-10-29T03:26:00.000Z",
  "seriesId": "01M60000000000000000000013",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "terminated"
  }
}
```

## 5. 后继 Task 的创建 Request 与系列规划记录

### 5.1 创建后继 Task：eligible 与 terminated 两种完整 Request

**Before：** Check/Probe 不自动生成后继，没有对应 Request 对象；
Coordinator 的旧 recurrence 已在第 2 节展示，不以 `{}` 冒充统一旧协议。

**After / eligible：** 第 1.1 轮的后继为 03:22:00Z，
仍用浮动来源并继承 series；不是拿最终旧 digest 替换后继的选版意图。
该请求由服务端以新的幂等 Request ID `01M60000000000000000000003` 生成，
成功建立后独立分配 `01M60000000000000000000007`；pending 位置保存的是这个 Task。

```json
{
  "requestId": "01M60000000000000000000003",
  "checker": {
    "url": "https://example.test/checker/latest.tgz"
  },
  "subject": {
    "root": "D:\\project"
  },
  "context": {},
  "language": "en",
  "freshness": "completed-after-eligible",
  "timeoutMs": 30000,
  "eligibleAt": "2026-10-29T03:22:00.000Z",
  "seriesId": "01M6000000000000000000001D",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "eligible"
  }
}
```

**After / terminated：** 假定第 1.2 轮 Task 在 03:20:25Z 正常或失败终结，
其后继 eligible 为 03:21:25Z，不是旧 eligible 加一分钟。
新 Request ID 为 `01M60000000000000000000019`，新 Task ID 为 `01M6000000000000000000001B`，
series 仍是首个 Task 的 `01M6000000000000000000001A`。

```json
{
  "requestId": "01M60000000000000000000019",
  "objective": {
    "url": "https://example.test/objective/v1.tgz",
    "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "subject": {
    "root": "D:\\project"
  },
  "context": {},
  "language": "en",
  "freshness": "started-after-eligible",
  "timeoutMs": 60000,
  "eligibleAt": "2026-10-29T03:21:25.000Z",
  "seriesId": "01M6000000000000000000001A",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "terminated"
  }
}
```

### 5.2 Series 规划记录：新的逻辑结构，不是新公开 API

**Before：** Check/Probe 无此记录。Coordinator 的 predecessor 链不是同形 series 记录。

**After：** 为展示唯一 pending 和一次后继生成，暂给出一种最小逻辑记录。
`scope` 是服务端授权上下文，不能由 Request 任意自授；
`generation`、前驱及 successor 记录是实现建议，不是已决定的数据库 schema。
只保存 latestSuccessor 的示例不等于可丢弃历史去重事实，实际持久层须能重放。

```json
{
  "scope": "local-owner",
  "service": "checker",
  "seriesId": "01M6000000000000000000001D",
  "pendingTaskId": "01M60000000000000000000007",
  "pendingRequestId": "01M60000000000000000000003",
  "generation": 2,
  "latestSuccessor": {
    "predecessorTaskId": "01M60000000000000000000006",
    "successorTaskId": "01M60000000000000000000007",
    "anchor": "eligible",
    "anchorAt": "2026-10-29T03:21:00.000Z",
    "eligibleAt": "2026-10-29T03:22:00.000Z"
  }
}
```

## 6. 取消与重复规划 Response

### 6.1 取消尚未激活的 Task

Before 当前取消接口可以作用于 preparing 等非终态。
After 仅允许 pending；以下是取消操作返回的完整快照。

**Before：**

```json
{
  "taskId": "01M60000000000000000000007",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 3,
  "state": "cancelled",
  "acceptedAt": "2026-10-29T03:21:00.000Z",
  "freshness": "completed-after-request",
  "error": {
    "code": "task_cancelled",
    "stage": "schedule",
    "message": "Task cancelled."
  }
}
```

**After：** 删除该轮继续规划的资格，不回溯取消已执行的第一轮。
终态保留 scheduled prefetch 信息不代表预优化仍会启动。
取消记录终结时间，但已撤销后继规划权，不按 terminated 生成下一轮。

```json
{
  "taskId": "01M60000000000000000000007",
  "requestId": "01M60000000000000000000003",
  "seriesId": "01M6000000000000000000001D",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 2,
  "state": "cancelled",
  "terminatedAt": "2026-10-29T03:21:10.000Z",
  "receivedAt": "2026-10-29T03:21:00.000Z",
  "eligibleAt": "2026-10-29T03:22:00.000Z",
  "deadlineAt": "2026-10-29T03:22:30.000Z",
  "freshness": "completed-after-eligible",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "prefetch": {
    "state": "scheduled",
    "scheduledAt": "2026-10-29T03:21:50.000Z"
  },
  "error": {
    "code": "task_cancelled",
    "stage": "schedule",
    "message": "Pending task cancelled."
  }
}
```

对已经 running 的 Task 发出相同操作，Before 返回 cancelled 快照；
After 建议 HTTP 409，明确拒绝，不转而取消另一个 pending Task：

```json
{
  "error": {
    "code": "task_not_pending",
    "stage": "schedule",
    "message": "Only pending tasks can be cancelled."
  }
}
```

### 6.2 重复规划：新 Task 的 cancelled 快照

**Before：** 当前 Check/Probe 没有 series 唯一 pending 规则，因此无法输入 series
来复现此场景；没有 `duplicate_planning` 响应。幂等键重试是另一机制，不冒充此 Before。

**After：** 已有 `01M60000000000000000000007` 的情况下产生 `01M60000000000000000000008`；
保留原任务，新任务记录 cancelled。下面是第 6.1 用户取消之前的另一个分支场景。
`planningConflict` 是建议的诊断字段，保留任务必须与当前授权范围一致。

```json
{
  "taskId": "01M60000000000000000000008",
  "requestId": "01M60000000000000000000004",
  "seriesId": "01M6000000000000000000001D",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 2,
  "state": "cancelled",
  "terminatedAt": "2026-10-29T03:21:00.101Z",
  "receivedAt": "2026-10-29T03:21:00.100Z",
  "eligibleAt": "2026-10-29T03:22:00.000Z",
  "deadlineAt": "2026-10-29T03:22:30.000Z",
  "freshness": "completed-after-eligible",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "error": {
    "code": "duplicate_planning",
    "stage": "schedule",
    "message": "An existing pending task retains the series planning slot."
  },
  "planningConflict": {
    "retainedTaskId": "01M60000000000000000000007"
  }
}
```

## 7. Events：过滤请求与完整事件 payload

**Before：** `GET /events?taskId=01M60000000000000000000006`，事件名 `task.updated`，
以下为一条完整 data payload；没有 series 过滤参数。

```json
{
  "taskId": "01M60000000000000000000006",
  "snapshot": {
    "taskId": "01M60000000000000000000006",
    "hostInstance": "01M6000000000000000000000D",
    "revision": 1,
    "state": "accepted",
    "acceptedAt": "2026-10-29T03:20:00.000Z",
    "freshness": "completed-after-request"
  }
}
```

**After：** 建议 `GET /events?seriesId=01M6000000000000000000001D`；
即使订阅早于第二轮创建，也能收到第二轮的这一条完整 data payload。
事件名暂保留 task.updated，新查询的版本/过滤组合及游标协议待定。

```json
{
  "seriesId": "01M6000000000000000000001D",
  "requestId": "01M60000000000000000000003",
  "taskId": "01M60000000000000000000007",
  "snapshot": {
    "taskId": "01M60000000000000000000007",
    "requestId": "01M60000000000000000000003",
    "seriesId": "01M6000000000000000000001D",
    "hostInstance": "01M6000000000000000000000D",
    "revision": 1,
    "state": "pending",
    "receivedAt": "2026-10-29T03:21:00.000Z",
    "eligibleAt": "2026-10-29T03:22:00.000Z",
    "deadlineAt": "2026-10-29T03:22:30.000Z",
    "freshness": "completed-after-eligible",
    "recurrence": {
      "periodMs": 60000,
      "anchor": "eligible"
    },
    "prefetch": {
      "state": "scheduled",
      "scheduledAt": "2026-10-29T03:21:50.000Z"
    }
  }
}
```

相同事件 envelope 可承载准备更新、fallback、终态与恢复快照。
单轮 revision 不能用作整个 series 的全局游标；系列保留/分页设计仍需独立确定。

## 8. 持久记录与恢复 Response

本节保留先前占位设计，崩溃恢复细节按用户要求暂缓讨论。
本轮仅同步已确认身份、series 默认值和预优化术语，不把记录布局视作新决定。

### 8.1 未完成 Task 的逻辑持久记录

**Before：** Check/Probe 的 Task/Run 是含 Map、Promise、AbortController、timer
和服务内序号的内存对象，没有公开或持久化 JSON 记录。不能捏造一份旧存储格式来对照。
Coordinator 的持久事件已存在，不因此被删除或当作同形 Check/Probe 存储。

**After：** 以下展示一个尚未开始预优化的 pending Check 的完整逻辑恢复单元，
含原 Request、服务端身份、期限、准备时间及前驱。字段布局只是建议，
不把授权 scope 或幂等信息作为公开 SSE 数据。
已选版/运行中的记录还需持久准确版本、执行环境及尝试证据，不在本例凭空填充。

```json
{
  "kind": "check-task",
  "scope": "local-owner",
  "requestId": "01M60000000000000000000003",
  "taskId": "01M60000000000000000000007",
  "seriesId": "01M6000000000000000000001D",
  "predecessorTaskId": "01M60000000000000000000006",
  "generation": 2,
  "request": {
    "requestId": "01M60000000000000000000003",
    "checker": {
      "url": "https://example.test/checker/latest.tgz"
    },
    "subject": {
      "root": "D:\\project"
    },
    "context": {},
    "language": "en",
    "freshness": "completed-after-eligible",
    "timeoutMs": 30000,
    "eligibleAt": "2026-10-29T03:22:00.000Z",
    "seriesId": "01M6000000000000000000001D",
    "recurrence": {
      "periodMs": 60000,
      "anchor": "eligible"
    }
  },
  "snapshot": {
    "taskId": "01M60000000000000000000007",
    "requestId": "01M60000000000000000000003",
    "seriesId": "01M6000000000000000000001D",
    "hostInstance": "01M6000000000000000000000D",
    "revision": 1,
    "state": "pending",
    "receivedAt": "2026-10-29T03:21:00.000Z",
    "eligibleAt": "2026-10-29T03:22:00.000Z",
    "deadlineAt": "2026-10-29T03:22:30.000Z",
    "freshness": "completed-after-eligible",
    "recurrence": {
      "periodMs": 60000,
      "anchor": "eligible"
    },
    "prefetch": {
      "state": "scheduled",
      "scheduledAt": "2026-10-29T03:21:50.000Z"
    }
  },
  "successorPlanning": {
    "state": "not-triggered"
  }
}
```

恢复必须同时校验这个 Task 与 series pending 槽位、后继去重事实的一致性。
此处不承诺“一行 JSON”即可实现原子性，也不定义 durable schema 版本号。

### 8.2 重启后查询原 Task

以下发生在第 6 节取消之前的独立分支：03:21:20Z 服务重启，Task 仍未到准备时间。

**Before：** 原 Check/Probe 仅保留在旧进程；新服务查询不存在的原 ID 返回 HTTP 404。

```json
{
  "error": {
    "code": "task_unavailable",
    "stage": "schedule",
    "message": "Task missing or retention expired."
  }
}
```

**After：** HTTP 200 返回原 Task，身份/eligible/deadline 不变。
hostInstance 更新不是伪装成原进程；SDK 需认得明确的恢复证据，不能一律 host_restarted。
recovery 字段是新建议，不意味着允许自动恢复任意已经运行的 Execution。

```json
{
  "taskId": "01M60000000000000000000007",
  "requestId": "01M60000000000000000000003",
  "seriesId": "01M6000000000000000000001D",
  "hostInstance": "01M6000000000000000000000E",
  "revision": 2,
  "state": "pending",
  "receivedAt": "2026-10-29T03:21:00.000Z",
  "eligibleAt": "2026-10-29T03:22:00.000Z",
  "deadlineAt": "2026-10-29T03:22:30.000Z",
  "freshness": "completed-after-eligible",
  "recurrence": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "prefetch": {
    "state": "scheduled",
    "scheduledAt": "2026-10-29T03:21:50.000Z"
  },
  "recovery": {
    "previousHostInstance": "01M6000000000000000000000D",
    "recoveredAt": "2026-10-29T03:21:20.000Z"
  }
}
```

## 评审时不要由示例推定的事项

这些完整对象用于看清字段之间的关系，不是绕过待决项的定稿：

- 新 wire schema 与具体路由形态；
- recurrence 双 anchor 的最终默认值、terminated 模式无 pending 时如何停止；
- 服务预优化的具体配置字段、限额及正式 preparing 的进展字段；
- fallback 旧版选择、最大陈旧度及 scope；
- 同 series 跨模块作用域、公共错误码/状态码及新 HTTP/SDK 定义；
- durable schema、历史游标和运行中 Execution 的崩溃重试策略（暂缓讨论）。
- 是否需要独立的调用方动态依赖固定能力；若需要可称 dependencyBindings，
  不以根 Objective 的静态 Checker 绑定作为保留重复输入的理由。

Request ID 为幂等 ID、Task ID 独立、series 默认取首个 Task ID、
eligible 后进入正式 PREPARING、terminated 包括失败/超时、
取消 pending 不生后继以及错过周期不补齐，均已确认，不再列为未决项。
preparation policy 属于服务配置、默认不预取不回退，以及普通 Probe 不重复传根/静态
Checker bindings，同样已确认；Before 中的旧字段和服务输出的记录不因此删掉。

本次只新增文档示例，不提交生命周期接受事件，也不把这些 JSON 发给现有接口执行。
