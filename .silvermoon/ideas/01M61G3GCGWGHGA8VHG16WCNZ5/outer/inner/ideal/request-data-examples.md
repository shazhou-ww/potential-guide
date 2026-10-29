# 关键数据结构：完整 Before / After 示例

本文是 [Request 生命周期修订](./request-lifecycle-revision.md) 的配套示例，
只列发生变化的数据结构，不重复未修改的 Artifact、业务结果或 Reference 契约。
抽象规则和原子状态分类见[任务判定树与解锁过程](./task-state-model.md)。

## 阅读约定

- **Before** 对照 `127666e4ec04` 的实际类型，不把新字段塞进旧协议。
- 新方案是全新、不兼容设计；Before 仅解释变化，不构成兼容、迁移或旧别名承诺。
- **After 全部是待评审草案，不是当前接口或已发布 schema。** 为便于读完整对象，
  本文暂选具体字段名、状态值和错误码；这些选择不代表已确认。
- 每个 JSON 块都是该场景的完整对象，无省略号、伪注释、变量替换或“同上”对象。
  可选且该状态尚不存在的字段不输出，例如尚未选版的初始响应没有 artifactRef/result/execution。
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
  Request/Task/Series/Execution/Observation/Invocation 等公共生成型身份
  统一为规范大写 ULID。作者定义的 levelId、problemId、局部 Checker 名称保留可读值；
  digest 和 revision 不叫 ID，也不使用 ULID。ULID 时间部分不裁定调度或授权。
  Before 的合成 ID 值也采用 ULID 方便对照，但不据此改变旧结构的字段。
  ID、URL、摘要和时间均为合成数据，
  摘要满足格式但不表示存在可下载的真实制品。
- 本文不发明 Regulation HTTP 服务：第 2 节将现有 Coordinator 调用输入
  与建议的统一 Regulation admission 输入对照，未规定新的 HTTP endpoint。
  内部持久记录不是调用方 Request，也不是公开 HTTP response。
- Task snapshot 以 state 为判别联合，不包含 hostInstance。公共身份/时间基底相同，
  所有抽象 Task 共用 pending/preparing/blocked/queued/running；
  当前 Check/Probe Request 不带 prerequisites，故其通常生成的任务不会停在 blocked；
  失败展开为过程原子状态，由协议表的 isFailed/isTerminated 分类，不增加 substate。
  Before 保留旧 hostInstance 和可选字段形状，仅用于对照。
- 顶层 receivedAt/eligibleAt/deadlineAt 保存整体时间事实与约束，
  不再使用 schedule 包装；preparation/execution 等二级对象保存累积过程事实，
  整体状态只由 state 表达，没有通用 progress 或各过程的平行当前状态。
  preparation.startedAt 可早于 eligible，因为过程可能 overlap；
  它不等于 Task 进入 preparing 状态的时间。Task 终结记录在 termination，
  不把所有失败都当成 execution 失败。`recurrence.anchor` 仍为 eligible/terminated。
- 核心过程及 snapshot 的二级字段统一为 preparation/readiness/allocation/execution。
  Request.prerequisites 仍是声明；readiness.satisfiedAt 才是条件就绪事实。
  详细过程进展由 SSE/历史事件查询，不使用 progress.process 来重复 state。
- After snapshot 删除数字 revision，新增服务端技术时间 timestamp；
  它表示本次一致事实视图的投影时点，不是业务事件时间或发送时间，不保证严格全序。
  timestamp/state 不作为不变事实继承；Request 的 requestId 仍是创建调用的身份。
- pending 仅表示时间未到，无 reason 或专属 pending 对象。时间已到、制品未就绪为
  preparing；有前置条件的抽象 Task 在时间与制品就绪、条件未满足时为 blocked。
  第 9 节使用当前接受 prerequisites 的 Regulation 入口；Check/Probe 仅在 Request 准入层不支持此字段。
- 所有 After snapshot 只用 preparation.artifactRef `{kind, url, digest}` 标识实际制品，
  不内嵌完整 manifest/schema。完整内容按准确 digest 单独查询，不能重新解析 latest。
  Before 的完整 artifact 对象保留作对照；执行 runtime/revision 等证据不能由制品查询代替。
- After snapshot 不再携带完整 evidence、嵌套子 Task 快照或最终 observationProgress。
  详细证据通过 taskId/executionId/seriesId 查询历史事件；SSE 和历史读取来自同一事实。
  第 10 节提供完整查询与事件例子，具体路径/游标拼写为草案。
- 成功选版用 preparation.resolution 表达 up-to-date/fallback/updated，替代早期草案的
  fallbackUsed；它与准确 artifactRef 同时确定并持续继承，未成功选定时不填写。
- After snapshot 不嵌入 request，不携带 freshness/recurrence 等请求策略。
  Request 实体和 HTTP body 中仍保留这些配置；通过 snapshot.requestId 独立授权查询原始请求，
  请求体解析失败时也应能按合法 requestId 查询审计错误，不伪造不存在的 Task。

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

### 1.5 原始 Request 查询：与 Task 快照分开

**Before：** 当前创建接口使用幂等 header，但没有本节所定义的独立 Request 审计查询；
不把 Task 查询冒充 Request 查询，也不虚构旧 response。

**After：** 以下 `/requests/{requestId}` 是新 API 路径草案，需鉴权（示例省略凭据）。
成功解析的请求返回原始实体，snapshot 只保留用于关联的 requestId。
本例查询第 1.2 的 Probe 请求，原始输入未给 eligibleAt/seriesId，
查询结果也不因 Task 已计算默认值而凭空补上。

```http
GET /requests/01M60000000000000000000018 HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
```

完整原始实体：

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

Task 的有效 eligibleAt、deadlineAt 和 seriesId 仍在 Task snapshot，
调用方想看原来的 freshness/recurrence/subject 则从此处读取。
查询不会重新受理、触发选版、延长 timeout 或生成后继。

解析错误的 Request 也必须能按合法 requestId 审计，无需 Task ID。
若 body 根本不是可解析 JSON，就不存在可返回的完整业务实体：
服务应返回/关联已记录的解析错误，不能将 `{}` 当作原始请求，
也不为了审计在公开响应中原样暴露可能含凭据的无效输入。
具体错误查询 envelope、保留期限、授权及 Request 不可用响应留待持久化/API 设计确定。
本节只确定独立查询职责与原始输入不回写原则，不新增任何 Request 字段到 snapshot。

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

After snapshot 共用身份/时间基底，按任务类型定义 state 判别联合；
失败原子与语义归类以[协议分类表](./task-state-model.md#4-单一-state-与协议定义的语义集合)为准。
SSE 及查询结果使用所属任务的同一类型，不能仅因 preparation.artifactRef.kind 都是 objective 就把 Probe 当作 Regulation。
公共字段为 requestId/taskId/seriesId/timestamp/state 和顶层 receivedAt/eligibleAt/deadlineAt。
freshness/recurrence 是原始 Request 的策略，不再在每份快照中重复。
历史过程时间戳只在真实发生时提供。
每个快照由已成立事实、整体 state 和技术 timestamp 组成。事实成立后，
后继必须原字段名、原路径、原值继承；未发生不填充，也不另附当前进展对象。
过程对象可增加新事实，但既有叶子路径不变。不存在 facts 大包装，也不存在按 state 切换的字段别名。

| state | 当前状态的数据 | 必须避免的混搭 |
|---|---|---|
| pending | 身份、整体时间约束及提前成立的过程事实 | 无请求体/策略、reason/pending 对象、实际业务执行或结果 |
| preparing | 已发生的 preparation 事实；未实际开始时可无该分组 | 无虚构过程开始、当前进展或最终 result |
| blocked | 制品准备事实，详细条件判断另查事件 | 无父实际执行或最终 result |
| queued | 已就绪事实，已正式绑定时可有 allocation/execution 事实 | 无临时预约详情、虚构的实际执行开始或结果 |
| running | 准备/就绪事实、execution.executionId/startedAt | 无当前进展、最终 result 或 termination |
| completed | 所有既有事实、result、execution 完成和 termination | 无完整 evidence 或活跃 progress |
| 各过程失败原子 | 路径要求的既有事实和 termination 原因 | 无活跃 progress、成功 result 或虚构过程 |
| timed_out/cancelled（暂定控制终结） | 所有实际已有事实和 termination | 不补造未发生的过程 |

`hostInstance` 不属于公共基底或任何 After 分支。路由如需实例信息应置于外围，
内部实例世代仍可用于所有权与迟到写入仲裁；此处不定义额外路由 envelope。
下面的对象是各状态各自的数据类型，不是一个所有属性均可选的宽泛类型。
JSON Schema 的互斥分支与 SDK 类型必须同时验证必需字段和禁止字段。
跨状态还需检查事实继承；仅让单个对象通过 schema 不能证明它没有丢掉前序记录。
timestamp/state 是投影元数据，不能作为不变事实原值继承；不再要求 revision 增长。
fetch 尝试、最近条件求值与临时 reservation 的详细历史在事件中，
不因它们含有时间戳或子任务 ID 就把集合累积到快照。
当前 Check/Probe Request 禁止 prerequisites，即使空数组也不能静默接受；
抽象 Task 快照仍支持统一的 blocked/readiness_failed 和 readiness 过程，
不可把入口的字段限制扩大为 Task 类型限制。
这些限制不影响 Checker 结果中的动态 requirements，也不禁止 Probe 解释动态依赖。

preparation.artifactRef 在已选定分支中仅有 kind、url、digest。比如收到 Checker 的准确 digest 后，
可在该服务挂载点下查询下面的路径（示例省略鉴权凭据）：

```http
GET /artifacts/sha256%3Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa HTTP/1.1
Host: 127.0.0.1:8080
```

完整 manifest、runtime 声明和文档等由准确制品查询/API 提供；
任务 snapshot 本身不内嵌这些定义。查询仍需来源授权；内容不可用时显式失败，
不能改为 resolve `latest.tgz` 并把新内容冒充原 digest。
这是制品定义查询，不重算或替代该 Task 的实际运行环境、worker revision 和选版证据。

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
state 已表示时间未到，不再增加 reason 或 pending 对象。预取安排属于服务优化。

```json
{
  "taskId": "01M60000000000000000000006",
  "requestId": "01M60000000000000000000002",
  "seriesId": "01M6000000000000000000001D",
  "state": "pending",
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "deadlineAt": "2026-10-29T03:21:30.000Z",
  "timestamp": "2026-10-29T03:20:00.000Z"
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
收到时已经 eligible，所以初始快照直接为 preparing，不返回 reason=activation 的 pending。
本例制品尚未正式选定，没有 artifactRef；不是要求所有创建响应都从 preparing 开始。

```json
{
  "taskId": "01M6000000000000000000001A",
  "requestId": "01M60000000000000000000018",
  "seriesId": "01M6000000000000000000001A",
  "state": "preparing",
  "preparation": {
    "startedAt": "2026-10-29T03:20:00.010Z"
  },
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:20:00.000Z",
  "deadlineAt": "2026-10-29T03:21:00.000Z",
  "timestamp": "2026-10-29T03:20:00.010Z"
}
```

### 3.3 Queued：只展示资源排队，不保留 preparation 进展

下面展示主 Check 场景的排队阶段。Before 的 waiting 已预约一个执行；
After 统一叫 queued，示例尚无执行 ID，因此不添加排队 reason 或空预约对象。
已预约而尚未开始时仍为 queued，可带 reservation.executionId，
不能仅因获得预约就报告 running。
提前获取、校验和回退已结束，快照保留真实准备时间、准确选择和已成立的 resolution；
完整决定证据仍保存在事件中，不能把这个已知回退事实拖到 completed 才输出。

**Before：**

```json
{
  "taskId": "01M60000000000000000000006",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 4,
  "state": "waiting",
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
  "executionId": "01M60000000000000000000001"
}
```

**After：**

```json
{
  "taskId": "01M60000000000000000000006",
  "requestId": "01M60000000000000000000002",
  "seriesId": "01M6000000000000000000001D",
  "state": "queued",
  "preparation": {
    "startedAt": "2026-10-29T03:20:50.000Z",
    "completedAt": "2026-10-29T03:21:00.009Z",
    "artifactRef": {
      "kind": "checker",
      "url": "https://example.test/checker/latest.tgz",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "language": "en",
    "resolution": "fallback"
  },
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "deadlineAt": "2026-10-29T03:21:30.000Z",
  "timestamp": "2026-10-29T03:21:00.009Z"
}
```

### 3.4 Running：必有实际执行关联，没有完成结果

**Before：**

```json
{
  "taskId": "01M60000000000000000000006",
  "hostInstance": "01M6000000000000000000000D",
  "revision": 5,
  "state": "running",
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
  "executionStartedAt": "2026-10-29T03:20:02.000Z"
}
```

**After：** 准备已结束，保留其时间戳，不复制 preparation 对象。
当前详细进展由事件查询，不添加 progress 容器；执行结果尚不存在。
artifactRef、language、resolution 继续继承排队阶段，新增实际执行身份和开始时间。

```json
{
  "taskId": "01M60000000000000000000006",
  "requestId": "01M60000000000000000000002",
  "seriesId": "01M6000000000000000000001D",
  "state": "running",
  "preparation": {
    "startedAt": "2026-10-29T03:20:50.000Z",
    "completedAt": "2026-10-29T03:21:00.009Z",
    "artifactRef": {
      "kind": "checker",
      "url": "https://example.test/checker/latest.tgz",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "language": "en",
    "resolution": "fallback"
  },
  "execution": {
    "executionId": "01M60000000000000000000001",
    "startedAt": "2026-10-29T03:21:00.010Z"
  },
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "deadlineAt": "2026-10-29T03:21:30.000Z",
  "timestamp": "2026-10-29T03:21:00.010Z"
}
```

## 4. 准备/回退及完成 Response

成功版本仲裁统一使用 preparation.resolution，三个完整快照场景分别是：

| 方式 | 场景 | 必须保留的含义 |
|---|---|---|
| up-to-date | 9.2 的已就绪父 Task | 已确认既有内容满足指定版本，不只是“缓存存在” |
| fallback | 4.2 的 Completed Check | 更新失败后按策略使用既有可用版本，错误详情保留在历史事件 |
| updated | 4.3 的 Completed Probe | 本次获取并验证的版本，不保证相对上次 digest 变化 |

未成功选定版本时不出现 resolution，原子状态和 timestamp 也不能用于猜测它。
Request 明确固定 digest 时不能 fallback 换成另一个版本；业务不通过不触发重新选版。
早期草案的 fallbackUsed 已删除，不与 resolution 并存。

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

**After：** 03:20:52Z 预优化找到回退候选，尚未 eligible，因此仍 pending。
Task 已积累 preparation.startedAt 的过程事实，但没有正式选择的 artifactRef 或业务结果。
不携带 preparing 的活跃 progress，也不用顶层 error
把优化失败冒充 Task 失败。更新错误由服务诊断/优化事件记录；
正式准备再做准入决定，最终回退摘要见 4.2，完整历史决策见第 10 节，
不能因精简快照而静默吞掉更新错误。

```json
{
  "taskId": "01M60000000000000000000006",
  "requestId": "01M60000000000000000000002",
  "seriesId": "01M6000000000000000000001D",
  "state": "pending",
  "preparation": {
    "startedAt": "2026-10-29T03:20:50.000Z"
  },
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "deadlineAt": "2026-10-29T03:21:30.000Z",
  "timestamp": "2026-10-29T03:20:52.000Z"
}
```

### 4.2 Completed Check：结果与小摘要保留，完整证据移出

Before 给出完整 manifest、业务 payload 和执行环境；After 只保留准确 artifactRef、
业务结果和小摘要，运行环境/选版详情按第 10 节的历史事件查询。
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

**After：** Task 的 terminatedAt 与 Execution 完成时间分开。
checkedAt、transportDigest 和 manifest 从准确制品查询获取，不逐快照重复传输。
终态没有 preparation/prefetch 活跃进展或完整 evidence。
preparation.resolution=fallback 表示采用旧版回退；准确版本在 preparation.artifactRef，
旧版来源和更新错误在 Task 历史事件，实际 runtime/revision 在 Execution 事件。

```json
{
  "taskId": "01M60000000000000000000006",
  "requestId": "01M60000000000000000000002",
  "seriesId": "01M6000000000000000000001D",
  "state": "completed",
  "result": {
    "ok": true,
    "problems": []
  },
  "preparation": {
    "startedAt": "2026-10-29T03:20:50.000Z",
    "completedAt": "2026-10-29T03:21:00.009Z",
    "artifactRef": {
      "kind": "checker",
      "url": "https://example.test/checker/latest.tgz",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "language": "en",
    "resolution": "fallback"
  },
  "execution": {
    "executionId": "01M60000000000000000000001",
    "startedAt": "2026-10-29T03:21:00.010Z",
    "completedAt": "2026-10-29T03:21:04.000Z"
  },
  "termination": {
    "terminatedAt": "2026-10-29T03:21:04.010Z"
  },
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "deadlineAt": "2026-10-29T03:21:30.000Z",
  "timestamp": "2026-10-29T03:21:04.010Z"
}
```

### 4.3 Completed Probe：组合结果与子 Task 历史关联

独立场景：一个 Objective 调用一个 Checker，全部通过。
Before 展开 result、观察进展及 evidence.checks[].snapshot；
After 保留本 Task 的业务结果，不再内嵌完整观察进展或子 Task 树。
子 Check 是本次组合观察的一次性需求，不自动继承根 Probe 的递归策略或 series；
其归属通过历史事件中的 invocation、父观察、childTaskId/childExecutionId 关联，
调用方按需读取子 Task 和执行记录，不必在每个根快照中再次接收。
After 的 result 只表达相对于外层 artifactRef 的业务结果：
删除 current.objective、根 bindings 和仅由问题数量生成的 gapSummary。
动态依赖解析记录由历史事实提供，不能再包装成 result.bindings 整表回传。
若某个业务问题明确指向另一个依赖 Objective，其准确引用仍有意义，不能机械删除。
observedAt 是实际观察时间，不等于 Execution 完成或 Task 终结时间，本次保留。

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
本例 Objective 从本次获取并验证的内容选定，因此 preparation.resolution=updated；
并非仅因 completed 就自动归类 updated，也不宣称它比之前的 digest 更新。

```json
{
  "taskId": "01M6000000000000000000001A",
  "requestId": "01M60000000000000000000018",
  "seriesId": "01M6000000000000000000001A",
  "state": "completed",
  "result": {
    "current": {
      "levelId": "ready"
    },
    "problems": [],
    "observedAt": "2026-10-29T03:20:01.090Z"
  },
  "preparation": {
    "startedAt": "2026-10-29T03:20:00.010Z",
    "completedAt": "2026-10-29T03:20:00.180Z",
    "artifactRef": {
      "kind": "objective",
      "url": "https://example.test/objective/v1.tgz",
      "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    "language": "en",
    "resolution": "updated"
  },
  "execution": {
    "executionId": "01M60000000000000000000017",
    "startedAt": "2026-10-29T03:20:00.200Z",
    "completedAt": "2026-10-29T03:20:01.100Z"
  },
  "termination": {
    "terminatedAt": "2026-10-29T03:20:01.110Z"
  },
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:20:00.000Z",
  "deadlineAt": "2026-10-29T03:21:00.000Z",
  "timestamp": "2026-10-29T03:20:01.110Z"
}
```

### 4.4 正式 PREPARING：一定在 eligible 后

独立场景展示状态顺序：Before 接收后立即 preparing；
After 预优化可以很早开始；本 Check 请求未带 prerequisites，Task 到 03:21:00Z 才投影为 preparing。
过程开始事实使用 preparation.startedAt，与后续 queued/running/completed 同名同值，
本例始于 03:20:50Z。Task 到 03:21:00Z 后才投影为 preparing；
具体尝试的 startedAt 由历史事件记录，不用它替代状态转移或 Task 过程事实时间。
以下展示提前 fetch 未成功、当前进入 select 步骤判断候选/回退的分支，
不假装已经有正式选中的 artifactRef 或 execution。

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
  "state": "preparing",
  "preparation": {
    "startedAt": "2026-10-29T03:20:50.000Z"
  },
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "deadlineAt": "2026-10-29T03:21:30.000Z",
  "timestamp": "2026-10-29T03:21:00.001Z"
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
不是把 deadline 伪造为已发生的结束事件。After 暂用原子状态 timed_out，
termination.lastState=pending 只说明此前位置，不是失败过程分类。

```json
{
  "taskId": "01M60000000000000000000013",
  "requestId": "01M60000000000000000000011",
  "seriesId": "01M60000000000000000000013",
  "state": "timed_out",
  "termination": {
    "terminatedAt": "2026-10-29T03:25:00.000Z",
    "error": {
      "code": "task_timeout",
      "stage": "schedule",
      "message": "Task deadline expired."
    },
    "lastState": "pending"
  },
  "receivedAt": "2026-10-29T03:19:00.000Z",
  "eligibleAt": "2026-10-29T03:20:00.000Z",
  "deadlineAt": "2026-10-29T03:20:30.000Z",
  "timestamp": "2026-10-29T03:25:00.000Z"
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

**After：** 为展示唯一 pending 和一次后继生成，暂给出一种可重建的 Series 索引投影。
`scope` 是服务端授权上下文，不能由 Request 任意自授；
`generation`、前驱及 successor 记录是实现建议，不是已决定的数据库 schema。
pendingRequestId 从 pendingTaskId 对应的 Task 取得，不再重复保存。
latestSuccessor 和 generation 来自规划事实，是查询/仲裁索引，不是另一份可独立修改的真相。
只缓存 latestSuccessor 不等于可以丢弃历史去重事实；事务和重放细节仍待讨论。

```json
{
  "scope": "local-owner",
  "service": "checker",
  "seriesId": "01M6000000000000000000001D",
  "pendingTaskId": "01M60000000000000000000007",
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
取消终态不再保留 scheduled prefetch 等活跃进展。
取消记录终结时间，但已撤销后继规划权，不按 terminated 生成下一轮。

```json
{
  "taskId": "01M60000000000000000000007",
  "requestId": "01M60000000000000000000003",
  "seriesId": "01M6000000000000000000001D",
  "state": "cancelled",
  "termination": {
    "terminatedAt": "2026-10-29T03:21:10.000Z",
    "error": {
      "code": "task_cancelled",
      "stage": "schedule",
      "message": "Pending task cancelled."
    }
  },
  "receivedAt": "2026-10-29T03:21:00.000Z",
  "eligibleAt": "2026-10-29T03:22:00.000Z",
  "deadlineAt": "2026-10-29T03:22:30.000Z",
  "timestamp": "2026-10-29T03:21:10.000Z"
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
  "state": "cancelled",
  "termination": {
    "terminatedAt": "2026-10-29T03:21:00.101Z",
    "error": {
      "code": "duplicate_planning",
      "stage": "schedule",
      "message": "An existing pending task retains the series planning slot."
    },
    "planningConflict": {
      "retainedTaskId": "01M60000000000000000000007"
    }
  },
  "receivedAt": "2026-10-29T03:21:00.100Z",
  "eligibleAt": "2026-10-29T03:22:00.000Z",
  "deadlineAt": "2026-10-29T03:22:30.000Z",
  "timestamp": "2026-10-29T03:21:00.101Z"
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
事件名暂保留 task.updated，data envelope 只包含 type 和 snapshot；
身份从 snapshot 取得，不在外围再重复三个 ID。游标如需携带属于事件层，
不能用这些重复 ID 或 Task revision 替代历史位置。

```json
{
  "type": "task.updated",
  "snapshot": {
    "taskId": "01M60000000000000000000007",
    "requestId": "01M60000000000000000000003",
    "seriesId": "01M6000000000000000000001D",
    "state": "pending",
    "receivedAt": "2026-10-29T03:21:00.000Z",
    "eligibleAt": "2026-10-29T03:22:00.000Z",
    "deadlineAt": "2026-10-29T03:22:30.000Z",
    "timestamp": "2026-10-29T03:21:00.000Z"
  }
}
```

本节 task.updated 是当前快照投影通知，不是保存全部证据的唯一记录格式。
准备更新、fallback、执行和关联事实通过第 10 节的结构化历史事件追溯；
实时通知必须与这些事实同源，不依赖客户端恰好收全 SSE。
snapshot 无 revision；timestamp 不能用作整个 series 的全局游标，历史采用独立稳定游标。

## 8. 持久记录与恢复 Response

本节保留先前占位设计，崩溃恢复细节按用户要求暂缓讨论。
本轮仅同步已确认身份、series 默认值和预优化术语，不把记录布局视作新决定。

### 8.1 未完成 Task 的恢复视图：事实与缓存分开

**Before：** Check/Probe 的 Task/Run 是含 Map、Promise、AbortController、timer
和服务内序号的内存对象，没有公开或持久化 JSON 记录。不能捏造一份旧存储格式来对照。
Coordinator 的持久事件已存在，不因此被删除或当作同形 Check/Probe 存储。

**After：** 以下只展示一个逻辑恢复读取视图，不声明实际存储行布局。
request 是原始不可变输入；cachedSnapshot 是按受理/执行事实派生、可重建的缓存，
不是另一份能独立修改的身份和调度配置。外层不再重复 requestId/taskId/seriesId。
两者重复出现的字段是输入与投影关系，缓存必须校验一致性，不能各自作为事实源。
这是内部恢复读取视图，不是 Task snapshot 的公共外层 envelope；
cachedSnapshot 不再含 freshness/recurrence，requestId 指向的原始实体仍完整保留这些输入。
predecessorTaskId、generation 和 successorPlanning 同样属于规划事实的投影。
此处不决定具体日志/索引事务，授权 scope 也不是公开 SSE 数据。
已选版/运行中 Task 的准确版本、执行环境和尝试信息从对应历史事件恢复。

```json
{
  "kind": "check-task-recovery-view",
  "scope": "local-owner",
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
  "cachedSnapshot": {
    "taskId": "01M60000000000000000000007",
    "requestId": "01M60000000000000000000003",
    "seriesId": "01M6000000000000000000001D",
    "state": "pending",
    "receivedAt": "2026-10-29T03:21:00.000Z",
    "eligibleAt": "2026-10-29T03:22:00.000Z",
    "deadlineAt": "2026-10-29T03:22:30.000Z",
    "timestamp": "2026-10-29T03:21:00.000Z"
  },
  "successorPlanning": {
    "state": "not-triggered"
  }
}
```

恢复必须同时校验缓存投影与原始 Request、Task 事实、series pending 槽位及后继去重事实的一致性。
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

**After：** HTTP 200 返回原 Task，身份/eligible/deadline 不变，timestamp 标记本次读取时点。
公共快照不包含 hostInstance 或 previousHostInstance，也不新增依赖实例切换的
recovery 对象。内部仍须防止旧实例迟到写入；此处不定义持久机制或运行中执行重试。

```json
{
  "taskId": "01M60000000000000000000007",
  "requestId": "01M60000000000000000000003",
  "seriesId": "01M6000000000000000000001D",
  "state": "pending",
  "receivedAt": "2026-10-29T03:21:00.000Z",
  "eligibleAt": "2026-10-29T03:22:00.000Z",
  "deadlineAt": "2026-10-29T03:22:30.000Z",
  "timestamp": "2026-10-29T03:21:20.000Z"
}
```

## 9. Regulation prerequisites：Check 条件与动态治理

以下实体字段布局和进展名称为新设计草案。prerequisites 属于所有抽象 Task，
但当前只有 Regulation Request 接受其输入。Check/Probe Request 暂不支持该字段，
因此本组例子通过 Regulation 入口建立有条件任务，不改变全局状态模型。
Check/Probe 的动态业务 requirements 保留；它们仍受 eligible、授权、制品准入和资源约束。
prerequisites 是 Check 声明数组，
全部通过才能激活父 Task；每个元素不是已经受理的 Request，因此不预先塞入 requestId。
实际求值时由服务生成独立 Request/Task 身份。这里选择两个条件展示集合，
不需要将一个条件再包装成 Objective；built-in Objective 达标 Checker 是普通 Checker
契约的一种实现，URL 为合成例子，不声明已发布该内置制品。

### 9.1 创建 Regulation：完整 After 与准确 Before 入口

**Before：** 旧 Coordinator 使用第 2 节完整展示的 RequestCommand/PilotSpec，
没有本节的 prerequisites 输入与统一 Regulation Task 状态模型。
不再拿旧 Probe body 冒充治理请求的 Before，也不捏造不存在的旧 Regulation HTTP 接口。

**After：** 完整 Regulation Request 实体，幂等 ID 为
`01M60000000000000000000030`。若映射为 HTTP，requestId 仍走同值 header；
这里不新增 Regulation HTTP listener。
条件 0 等待依赖 Objective 的 subject 达到 ready，条件 1 检查本地许可文件。
它们属于这次治理 Task，不是 app Objective 的静态依赖，不改变该 Objective 的 digest。
未指定 recurrence，避免用这个例子擅自决定条件阻塞时如何周期规划。

```json
{
  "requestId": "01M60000000000000000000030",
  "objective": {
    "url": "https://example.test/objective/app-v1.tgz",
    "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "subject": {
    "root": "D:\\project"
  },
  "desiredLevel": "terminal",
  "priority": 1,
  "language": "en",
  "eligibleAt": "2026-10-29T04:20:00.000Z",
  "freshness": "started-after-eligible",
  "timeoutMs": 60000,
  "prerequisites": [
    {
      "checker": {
        "url": "https://example.test/builtin/objective-level-v1.tgz",
        "digest": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      },
      "subject": {
        "objective": {
          "url": "https://example.test/objective/database-v1.tgz",
          "digest": "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        },
        "subject": {
          "database": "development"
        },
        "expectedLevelId": "ready"
      }
    },
    {
      "checker": {
        "url": "https://example.test/checker/file-ready-v1.tgz",
        "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      "subject": {
        "path": "D:\\project\\ready.flag"
      }
    }
  ]
}
```

`expectedLevelId`、文件 path 等是这些 Checker 自己的 subject schema，
不是通用调度器根据 subject 字段名猜出来的特殊语法。其他自定义 Checker
也可用于 prerequisites。检查的 freshness/有效期与重查策略仍待收敛，
不能仅因没有在此例增加字段就认定历史结果永久可用。

### 9.2 父 Regulation Task：时间与制品已就绪，但条件未通过

**Before：** 没有同形的 Regulation blocked 快照；旧 Coordinator 的调度记录
不冒充这里的新 Task snapshot，也不再用旧 Probe 的 preparing 快照作为治理任务对照。

**After：** 服务在 04:20:02Z 记录条件求值。时间和 artifacts 均已就绪，
但条件 0 未通过，因此父 Regulation Task 为 blocked；条件 1 通过不能使其推进。
正式准备已经完成，保留其过程事实；没有父 Execution 或当前进展对象。
本例准确 Objective 已在授权缓存中，并已确认满足指定 digest，
所以 preparation.resolution=up-to-date；不是未经确认就把缓存当作最新。
父 snapshot 不再重复未通过条件列表或 progress；该次条件求值的历史事件
记录 index、子 taskId/executionId 和各结果，关联查询可以解释为什么 blocked。
被采用的通过事实才进入 readiness，不能把子执行证据伪装成父业务结果。

```json
{
  "taskId": "01M60000000000000000000031",
  "requestId": "01M60000000000000000000030",
  "seriesId": "01M60000000000000000000031",
  "state": "blocked",
  "preparation": {
    "startedAt": "2026-10-29T04:20:00.000Z",
    "completedAt": "2026-10-29T04:20:00.001Z",
    "artifactRef": {
      "kind": "objective",
      "url": "https://example.test/objective/app-v1.tgz",
      "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    "language": "en",
    "resolution": "up-to-date"
  },
  "receivedAt": "2026-10-29T04:19:30.000Z",
  "eligibleAt": "2026-10-29T04:20:00.000Z",
  "deadlineAt": "2026-10-29T04:21:00.000Z",
  "timestamp": "2026-10-29T04:20:02.000Z"
}
```

### 9.3 条件子 Check：可执行的完整 Request 及依赖需求

**Before：** 没有由本次 Regulation prerequisites 产生的子 Request；不能用空对象冒充。
已有 CheckerResult 支持动态 requirements，本次复用它，不重复发明一种自由文本协议。

**After：** 从条件 0 生成的完整 Check Request。当前这个创建入口不支持 prerequisites，
不会继承父 Regulation 的治理启动前提，
也不使用父 series；自己 eligible 后可以准备和执行，避免父子互等。
本例在父 eligible 时受理子检查，30 秒预算不超过父剩余 60 秒；
是否支持更早检查以及通用预算分配策略不由这个示例定稿。

```json
{
  "requestId": "01M60000000000000000000033",
  "checker": {
    "url": "https://example.test/builtin/objective-level-v1.tgz",
    "digest": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  },
  "subject": {
    "objective": {
      "url": "https://example.test/objective/database-v1.tgz",
      "digest": "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    },
    "subject": {
      "database": "development"
    },
    "expectedLevelId": "ready"
  },
  "language": "en",
  "eligibleAt": "2026-10-29T04:20:00.000Z",
  "freshness": "started-after-eligible",
  "timeoutMs": 30000
}
```

HTTP 的 `Idempotency-Key: 01M60000000000000000000033` 与实体一致；
服务独立分配 Task `01M60000000000000000000034`，默认 series 为同一个 Task ID。
下面是该 Check 的完整结果 payload：有效不通过且提供结构化治理目标，
Check Task 本身是 completed，而不是执行 failed。这里不是完整 Task Response，
也没有混入 execute 的 status/message envelope。

```json
{
  "ok": false,
  "problems": [],
  "requirements": [
    {
      "objective": {
        "kind": "objective",
        "url": "https://example.test/objective/database-v1.tgz",
        "digest": "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
      },
      "subject": {
        "database": "development"
      },
      "expectedLevelId": "ready"
    }
  ]
}
```

Coordinator 根据服务治理策略决定是否创建 Regulation；目标可以由需求推导，
权限、Agent 配置与预算不能由这个结果自行授予。若未授权则不启动治理，
父 Regulation 继续等待或最终按原期限终结。若 Check 执行失败，则显式展示故障，
不能捏造上述不通过 payload 或以故障授予治理权限。
这个正常 `ok:false + requirements` 也允许由普通 Check 返回，Probe 仍可解释这些动态需求。
Check 自身 completed 不等于其父 Regulation 的条件已通过；不能让子 Check 进入 blocked
来代替返回业务结果。外部条件不满足不阻止它执行，这正是探测与治理的区别。

### 9.4 Origin：因果审计不等于激活条件

只比较完整的 origin 对象，不把它当作 Request body。
**Before：** Coordinator 表示依赖产生原因时引用上游 Request：

```json
{
  "kind": "dependency",
  "consumerRequestRef": "01M60000000000000000000030"
}
```

**After：** 服务端为条件 Check Task 记录来源，关联父 Regulation Task 与条件项。
`prerequisite` kind 与 index 命名为草案；不是外部 Request 可任意声明的治理权限。
依赖 Regulation 还应能追溯产生需求的 Check Task，具体审计形状以后确定。

```json
{
  "kind": "prerequisite",
  "parentTaskId": "01M60000000000000000000031",
  "prerequisiteIndex": 0
}
```

### 9.5 父 Regulation 重查通过：进入治理资源调度

**Before：** 9.2 的父 blocked 快照代表此前未满足条件的状态。
**After：** 重查通过后制品不需要重新准备，若暂未获得资源则进入 queued。
两个条件的重新求值应在条件事件/证据中记录，不能把旧不通过结果或
“Regulation 已结束”改写成 passed。当前快照不再携带条件 progress，
累积 readiness.satisfiedAt 和准备过程事实；顶层 eligibleAt/deadlineAt 不顺延。

```json
{
  "taskId": "01M60000000000000000000031",
  "requestId": "01M60000000000000000000030",
  "seriesId": "01M60000000000000000000031",
  "state": "queued",
  "preparation": {
    "startedAt": "2026-10-29T04:20:00.000Z",
    "completedAt": "2026-10-29T04:20:00.001Z",
    "artifactRef": {
      "kind": "objective",
      "url": "https://example.test/objective/app-v1.tgz",
      "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    },
    "language": "en",
    "resolution": "up-to-date"
  },
  "readiness": {
    "satisfiedAt": "2026-10-29T04:20:10.000Z"
  },
  "receivedAt": "2026-10-29T04:19:30.000Z",
  "eligibleAt": "2026-10-29T04:20:00.000Z",
  "deadlineAt": "2026-10-29T04:21:00.000Z",
  "timestamp": "2026-10-29T04:20:10.000Z"
}
```

父 Regulation 到 eligible 已释放 pending 槽位，blocked 不与未来 pending 后继竞争。
条件证据有效期、重查频率、后继条件继承和未完成轮次积压限额仍须收敛；
不能用唯一 pending 约束代替整个系列的容量管理。

## 10. 历史事件查询：evidence 不再内嵌 snapshot

**Before：** 4.2/4.3 的完整旧快照携带 evidence（含 runtime、worker revision、
子 Task 快照和观察进展等），没有对应的统一历史分页查询 API。
现有 SSE 主要输出 task.updated，不把它的实时连接冒充历史查询。

**After：** 4.2/4.3 的新快照已移除 evidence，以已有身份查询结构化事实。
以下 `/event-history`、事件类型及分页字段是完整示例用的草案，不是现有可调用接口，
不新增 evidenceId 或独立 `/evidence` 数据模型。cursor 为不透明分页位置，
不是 ULID 业务身份、snapshot.timestamp 或客户端时间；不得由客户端解析或据此授予权限。

### 10.1 Task 历史：选版和 Execution 关联

查询第 4.2 节同一个 Task。本例从服务返回的既有位置继续，展示选版后的两条事实，
不是声称完整历史只有这两条：

```http
GET /event-history?taskId=01M60000000000000000000006&after=task6-before-selection&limit=2 HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
```

完整分页响应：

```json
{
  "events": [
    {
      "cursor": "task6-selection",
      "type": "task.artifact-selected",
      "occurredAt": "2026-10-29T03:21:00.009Z",
      "requestId": "01M60000000000000000000002",
      "taskId": "01M60000000000000000000006",
      "seriesId": "01M6000000000000000000001D",
      "data": {
        "artifactRef": {
          "kind": "checker",
          "url": "https://example.test/checker/latest.tgz",
          "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        },
        "fallbackFromTaskId": "01M60000000000000000000005",
        "updateError": {
          "code": "download_failed",
          "stage": "download",
          "message": "Artifact download failed."
        },
        "resolution": "fallback"
      }
    },
    {
      "cursor": "task6-execution-linked",
      "type": "task.execution-linked",
      "occurredAt": "2026-10-29T03:21:00.009Z",
      "requestId": "01M60000000000000000000002",
      "taskId": "01M60000000000000000000006",
      "seriesId": "01M6000000000000000000001D",
      "data": {
        "executionId": "01M60000000000000000000001"
      }
    }
  ],
  "nextCursor": "task6-execution-linked"
}
```

下一页使用原过滤条件和 nextCursor，不拿 snapshot.timestamp 当作位置：

```http
GET /event-history?taskId=01M60000000000000000000006&after=task6-execution-linked&limit=2 HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
```

下例表示当前查询边界内的最后一页。真实实现可能还有其他阶段事件，
事件分类、快照水位与分页边界需要在持久化设计中固定。

```json
{
  "events": [
    {
      "cursor": "task6-terminated",
      "type": "task.terminated",
      "occurredAt": "2026-10-29T03:21:04.010Z",
      "requestId": "01M60000000000000000000002",
      "taskId": "01M60000000000000000000006",
      "seriesId": "01M6000000000000000000001D",
      "data": {
        "state": "completed",
        "executionId": "01M60000000000000000000001"
      }
    }
  ],
  "nextCursor": null
}
```

nextCursor=null 只表示此查询边界没有下一页，不承诺未来不再产生事件；
历史接实时需要独立的交接水位，不能用 null 自动推导为可以无缝订阅。

### 10.2 Execution 历史：实际执行证据只记录一次

使用上一页关联到的 executionId 查询。该执行可以服务多个 Task，
事件不复制各 Task 的完整输入，也不公开全部 owner 列表：

```http
GET /event-history?executionId=01M60000000000000000000001&limit=2 HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
```

完整两条执行事实如下；workerRevision 对应原 evidence.revision，
不是 artifactRef 的内容 digest，与已移除的 Task 数字 revision 也不是一回事。
示例刻意把 actual runtime 和 workerRevision 留在事件中，证明精简 snapshot 不等于丢弃证据。

```json
{
  "events": [
    {
      "cursor": "execution1-started",
      "type": "execution.started",
      "occurredAt": "2026-10-29T03:21:00.010Z",
      "executionId": "01M60000000000000000000001",
      "data": {
        "artifactRef": {
          "kind": "checker",
          "url": "https://example.test/checker/latest.tgz",
          "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        },
        "runtime": {
          "type": "node",
          "version": "24.11.1",
          "platform": "win32",
          "architecture": "x64",
          "adapter": "node-commonjs-v1",
          "configuration": "{\"cleanupMs\":5000,\"deadlineMs\":30000,\"directories\":64,\"messageBytes\":8388608,\"observers\":64,\"queue\":64,\"records\":256,\"retentionMs\":60000,\"retireAfter\":100,\"workers\":4}"
        },
        "workerRevision": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
      }
    },
    {
      "cursor": "execution1-completed",
      "type": "execution.completed",
      "occurredAt": "2026-10-29T03:21:04.000Z",
      "executionId": "01M60000000000000000000001",
      "data": {
        "result": {
          "ok": true,
          "problems": []
        }
      }
    }
  ],
  "nextCursor": null
}
```

Execution.completed 是实际结果的唯一事实来源；Task.terminated 只记录该需求的
状态/终结时间并引用 executionId，不重复存储同一个业务 result。
查询 completed Task snapshot 时可以从关联执行投影 result，避免额外请求，
但不能独立维护第二份结果。若未来有 Task 特有的结果转换，需明确记录其独立语义，
不能直接套用“与执行结果相同”的去重规则。

### 10.3 子 Task 与 series 查询：关联，不递归展开整树

第 4.3 的 Probe 原先内嵌一个子 Task snapshot；After 可通过下面的完整关联事件追溯。
这是 Observation Execution 拥有的调用关系，执行事实使用 executionId 归属，
共享该 Probe 执行的多个父 Task 沿自己的 execution-linked 事件读取同一份记录。

```json
{
  "cursor": "probe-execution17-child-linked",
  "type": "execution.child-task-linked",
  "occurredAt": "2026-10-29T03:20:00.210Z",
  "executionId": "01M60000000000000000000017",
  "data": {
    "observationId": "01M60000000000000000000015",
    "invocationId": "01M60000000000000000000010",
    "checker": "pass",
    "levelId": "ready",
    "childTaskId": "01M6000000000000000000000C"
  }
}
```

查询 childTaskId 的 Task 历史可找到它与 `01M6000000000000000000000A` 的执行关联，
再读该 Execution 的实际 runtime/result；不用把子快照复制进父 snapshot。
observation/level/invocation 进展同样记录为结构化事实，不维护第二份完整 evidence 树。

系列历史读取使用同一分页模型，过滤将来加入的各轮 Task，具体查询边界仍以服务游标为准：

```http
GET /event-history?seriesId=01M6000000000000000000001D&limit=20 HTTP/1.1
Host: 127.0.0.1:8080
Accept: application/json
```

本例每次只选一个过滤维度；多维过滤的交并规则未定，不在示例里隐式猜测。
Task/Series 历史返回自己的事实和执行引用，不默认递归展开所有共享执行或其他 owner。
所有查询均需鉴权（示例省略凭据）；关联与游标不能绕过来源/作用域隔离。
历史缺失、清理或游标过期必须明确返回不可用，不能把空列表冒充没有发生过工作。
保留期限、SSE 游标续读和具体存储事务规则仍留到持久化讨论。

### 10.4 条件检查的详细进展：事件，不是 snapshot.progress

第 9.2 的父 Task 为 blocked；其具体哪个条件尚未满足，由下列完整历史事件表达，
不在 snapshot 的 readiness 分组内加一套可变 conditions/status。
这条事实与之前的 blocked 快照使用同一个父 Task、子任务和时间，
去掉 progress 不等于丢弃诊断证据。通过后的条件重查同样记录事件，
最终采用的就绪时间才作为 readiness.satisfiedAt 加入 Task 事实。

```json
{
  "cursor": "task31-readiness-evaluated",
  "type": "task.readiness-evaluated",
  "occurredAt": "2026-10-29T04:20:02.000Z",
  "requestId": "01M60000000000000000000030",
  "taskId": "01M60000000000000000000031",
  "seriesId": "01M60000000000000000000031",
  "data": {
    "satisfied": false,
    "checks": [
      {
        "index": 0,
        "taskId": "01M60000000000000000000034",
        "executionId": "01M60000000000000000000035",
        "state": "not-met"
      },
      {
        "index": 1,
        "taskId": "01M60000000000000000000037",
        "executionId": "01M60000000000000000000038",
        "state": "passed"
      }
    ]
  }
}
```

事件的 occurredAt 是业务事实发生时间，snapshot.timestamp 是读取投影时间；
数值可以恰好相同，但不能因此把它们定义成同一个字段或排序游标。

## 11. 连续快照：事实继承，技术时间与状态可变化

这些示例不是只有单对象 shape 正确即可；同一场景的后继快照还必须满足：

```text
previous.taskId = next.taskId
previous 的每个已知记录性字段在 next 中仍存在，字段名/路径/值均相同
timestamp/state 是读取元数据，不参加不变事实检查
允许事实完全相同，仅因投影时点变化而出现不同 state
```

### 11.1 现有完整例子的连续路径

| 场景 | 顺序 | 继承检查 |
|---|---|---|
| 主 Check | 3.1 pending → 4.1 pending → 4.4 preparing → 3.3 queued → 3.4 running → 4.2 completed | 受理身份/时间固定；准备开始时间路径固定；正式选择后的 artifactRef/language/resolution 一直保留 |
| Probe | 3.2 preparing → 4.3 completed | preparation.startedAt 始终为 03:20:00.010Z；允许未展示中间读取，不丢已知事实 |
| Regulation | 9.2 blocked → 9.5 queued | 保留 preparation 事实，增加 readiness.satisfiedAt，不在快照包含条件进展 |
| 后继取消 | 7 的 pending → 6.1 cancelled | 受理事实不变，增加取消事实；不伪造准备或执行 |
| 恢复分支 | 8.1 cachedSnapshot → 8.2 pending | 身份/时间原值保留；这是未发生 6.1 取消的替代场景，不拼接成终态反转 |

Task 级事实包括身份、顶层整体时间约束、preparation 中的正式选择、过程开始/完成、
execution 与 termination；没有发生的事实保持缺失。
各次 fetch 尝试时间、条件 evaluatedAt 和临时预约目标不是 Task 的固定阶段事实，
详细变化通过事件查询，不在 snapshot 引入同义的 progress 或过程 status 对象。
已确定的 resolution 不能改成另一方式或丢失；正式开始时间不能在切换字段路径时丢掉或改值。

### 11.2 独立超时场景：running → timed_out 仍继承已知事实

下列使用独立 Task/Request/Execution ULID，不与第 4.2 的成功场景共用终态。
**前序 running 完整快照：**

```json
{
  "taskId": "01M60000000000000000000051",
  "requestId": "01M60000000000000000000050",
  "seriesId": "01M60000000000000000000051",
  "state": "running",
  "preparation": {
    "startedAt": "2026-10-29T04:30:00.010Z",
    "completedAt": "2026-10-29T04:30:00.100Z",
    "artifactRef": {
      "kind": "checker",
      "url": "https://example.test/checker/latest.tgz",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "language": "en",
    "resolution": "fallback"
  },
  "execution": {
    "executionId": "01M60000000000000000000052",
    "startedAt": "2026-10-29T04:30:00.110Z"
  },
  "receivedAt": "2026-10-29T04:30:00.000Z",
  "eligibleAt": "2026-10-29T04:30:00.000Z",
  "deadlineAt": "2026-10-29T04:30:30.000Z",
  "timestamp": "2026-10-29T04:30:00.110Z"
}
```

**后继 timed_out 完整快照：** 该 Task 超时，但实际执行仍可能服务其他需求；
没有确认执行结束，就不填 execution.completedAt，不捏造 result。
已经成立的准确制品、回退事实、执行身份和阶段时间全部原名原值保留。

```json
{
  "taskId": "01M60000000000000000000051",
  "requestId": "01M60000000000000000000050",
  "seriesId": "01M60000000000000000000051",
  "state": "timed_out",
  "preparation": {
    "startedAt": "2026-10-29T04:30:00.010Z",
    "completedAt": "2026-10-29T04:30:00.100Z",
    "artifactRef": {
      "kind": "checker",
      "url": "https://example.test/checker/latest.tgz",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "language": "en",
    "resolution": "fallback"
  },
  "execution": {
    "executionId": "01M60000000000000000000052",
    "startedAt": "2026-10-29T04:30:00.110Z"
  },
  "termination": {
    "terminatedAt": "2026-10-29T04:30:30.001Z",
    "error": {
      "code": "task_timeout",
      "stage": "observe",
      "message": "Task deadline expired."
    },
    "lastState": "running"
  },
  "receivedAt": "2026-10-29T04:30:00.000Z",
  "eligibleAt": "2026-10-29T04:30:00.000Z",
  "deadlineAt": "2026-10-29T04:30:30.000Z",
  "timestamp": "2026-10-29T04:30:30.001Z"
}
```

### 11.3 必须拒绝的转移反例

- queued → running 时删除 preparation.startedAt 或正式 artifactRef。
- preparing → queued 时将同一开始事实从 preparation.startedAt 改到别的路径。
- 后继改写已有 receivedAt/eligibleAt/deadlineAt 或 preparation.startedAt。
- running → execution_failed/timed_out 时丢失 execution.executionId、preparation.language 或 resolution。
- 任一 After snapshot 混入 revision、progress 或过程下的当前 status/reason；
  preparation 事实对象本身必须保留，不能误删。

单个后继 shape 有时仍能合法，故必须同时验证服务端事实视图的前序和后继，
不是根据网络到达顺序或相同 timestamp 擅自排序。
这些检查不要求重放完整 evidence 树，也不提前决定持久化布局。

### 11.4 没有事实写入也能产生不同状态的快照

独立 Check Task，未配置提前准备。以下两次读取基于相同的受理事实，
只是服务端投影时间跨过 eligibleAt；第二次没有实际开始任何准备工作。
timestamp/state 改变无需创建一次 revision 更新，不能补造 preparation.startedAt。

```json
{
  "requestId": "01M60000000000000000000070",
  "taskId": "01M60000000000000000000071",
  "seriesId": "01M60000000000000000000071",
  "state": "pending",
  "timestamp": "2026-10-29T07:00:59.000Z",
  "receivedAt": "2026-10-29T07:00:00.000Z",
  "eligibleAt": "2026-10-29T07:01:00.000Z",
  "deadlineAt": "2026-10-29T07:01:30.000Z"
}
```

```json
{
  "requestId": "01M60000000000000000000070",
  "taskId": "01M60000000000000000000071",
  "seriesId": "01M60000000000000000000071",
  "state": "preparing",
  "timestamp": "2026-10-29T07:01:00.000Z",
  "receivedAt": "2026-10-29T07:00:00.000Z",
  "eligibleAt": "2026-10-29T07:01:00.000Z",
  "deadlineAt": "2026-10-29T07:01:30.000Z"
}
```

这是读取模型的例子，不意味着服务可以永远不启动实际准备或不发送必要通知。
后续工作实际开始才增加过程事实。timestamp 不用于计算 timeout；
deadlineAt 仍锚定原 eligibleAt，重复读取不会延长任务期限。
同刻 timestamp 可能对应不同事实视图，不能仅按时间相同去重；
查询与 SSE 的交接、水位和乱序响应策略仍需在接口协议中明确。

## 评审时不要由示例推定的事项

这些完整对象用于看清字段之间的关系，不是绕过待决项的定稿：

- 新 wire schema 与具体路由形态；
- recurrence 双 anchor 的最终默认值、terminated 模式无 pending 时如何停止；
- 服务预优化的具体配置字段、限额、独立优化事件及 preparation 子步骤形状；
- fallback 旧版选择、最大陈旧度及 scope；
- 同 series 跨模块作用域、公共错误码/状态码及新 HTTP/SDK 定义；
- 历史事件 API 具体路径、游标/水位协议、保留期限、SSE 续读，
  以及 durable schema 和运行中 Execution 的崩溃重试策略（暂缓细节讨论）。
- 是否需要独立的调用方动态依赖固定能力；若需要可称 dependencyBindings，
  不以根 Objective 的静态 Checker 绑定作为保留重复输入的理由。
- 条件 freshness/有效期、首次与重查时机、后继 prerequisites 继承、
  未完成轮次积压限额及依赖治理策略的具体配置。
- 是否扩展 preparing/blocked/queued 取消权限；当前仍仅取消 pending。
- timestamp 的服务时间域保证、校时/重启、HTTP 与 SSE 交接和同刻/乱序观察处理；
  历史 cursor 仍独立，不引入隐式 snapshot revision。

Request ID 为幂等 ID、Task ID 独立、series 默认取首个 Task ID、
eligible 后进入正式 PREPARING、terminated 包括失败/超时、
取消 pending 不生后继以及错过周期不补齐，均已确认，不再列为未决项。
preparation policy 属于服务配置、默认不预取不回退，以及普通 Probe 不重复传根/静态
Checker bindings，同样已确认；Before 中的旧字段和服务输出的记录不因此删掉。

本次只新增文档示例，不提交生命周期接受事件，也不把这些 JSON 发给现有接口执行。
