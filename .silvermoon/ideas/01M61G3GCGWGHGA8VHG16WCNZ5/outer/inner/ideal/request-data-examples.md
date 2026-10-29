# 关键数据结构：完整 Before / After 示例

本文是 [Request 生命周期修订](./request-lifecycle-revision.md) 的配套示例，
只列发生变化的数据结构，不重复未修改的 Artifact、业务结果或 Reference 契约。

## 阅读约定

- **Before** 对照 `127666e4ec04` 的实际类型，不把新字段塞进旧协议。
- **After 全部是待评审草案，不是当前接口或已发布 schema。** 为便于读完整对象，
  本文暂选具体字段名、状态值和错误码；这些选择不代表已确认。
- 每个 JSON 块都是该场景的完整对象，无省略号、伪注释、变量替换或“同上”对象。
  可选且该状态尚不存在的字段不输出，例如初始响应没有 artifact/result/execution。
  “完整例子”不表示把所有互斥状态的字段同时塞入一个对象。
- 字段暂沿用现有 camelCase，概念 `eligible_at/received_at/series_id`
  分别写成 `eligibleAt/receivedAt/seriesId`。PENDING 暂序列化为 `pending`。
  `acceptedAt → receivedAt` 是草案命名建议，不暗示旧字段已改名。
- `recursive` 暂用 `{periodMs, anchor}`；准备策略暂用
  `preparationPolicy: {leadMs, fallback}`，fallback 候选值为
  `none | previous-usable`。这些字段名与默认值仍待评审。
- After 的 freshness 暂用 `started-after-eligible | completed-after-eligible`，
  以免在旧 `*-after-request` 字面值上偷偷换义。实际协议升级方式尚未确定。
- request ID 与 task ID 是否同值尚未确定。示例用不同值展示角色，
  不要求客户端额外生成 request ID。ID、URL、摘要和时间均为合成数据，
  摘要满足格式但不表示存在可下载的真实制品。
- 本文不发明 Regulation HTTP 服务：第 2 节展示 Coordinator 的请求记录，
  不是新的 HTTP POST body。后续持久记录也不是公开 HTTP response。

## 1. Check / Probe 创建 Request

### 1.1 Check：浮动来源、未来 eligible、按 eligible 递归

**Before：** 当前 Checker v3 创建请求。它没有 eligible、series、recursive 或准备策略。

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
周期与准备提前量相互独立；输入 series 由调用方显式指定。

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
  "freshness": "completed-after-eligible",
  "timeoutMs": 30000,
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "seriesId": "workspace-checks",
  "recursive": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "preparationPolicy": {
    "leadMs": 10000,
    "fallback": "previous-usable"
  }
}
```

### 1.2 Probe：准确来源、按 completed 递归

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

**After：** 省略 eligible 和 series，服务端默认补齐；完成后再等待 60 秒。
显式 digest 不允许换成另一旧版，因此关闭 fallback。每个后继仍继承此准确引用，
不是所有 recursive 请求都会升级制品；只有浮动来源才重新选版。

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
  "freshness": "started-after-eligible",
  "timeoutMs": 60000,
  "recursive": {
    "periodMs": 60000,
    "anchor": "completed"
  },
  "preparationPolicy": {
    "leadMs": 10000,
    "fallback": "none"
  }
}
```

`targetLevel: "initial"` 仍是可选的单次输入验证能力；本例执行完整观察所以不传，
不以 recursive 模式改变其业务含义。

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
recursive 未提供，任务不会自动产生后继。

```json
{
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

## 2. Regulation：Coordinator 请求记录

Before 对应现有 `RegulationRequest` 元素，而不是整个 `RegulationRequests` 存储聚合。
targetKey 与 objectiveRevisionKey 引用聚合内其他记录；本节完整展示这个元素，
不把引用背后的 Subject/PilotSpec 假装内联到此类型中。
示例使用既有 Git 来源的 revision 引用，因此没有可选的非 Git `source` 字段。

**Before：** Coordinator 已有 eligibleAt、recurrence.intervalMs；
还没有统一的 series、received、deadline、freshness 或双锚点。

```json
{
  "ref": "reg-request-1",
  "targetKey": "target-1",
  "objectiveRevisionKey": "objective-revision-1",
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

**After：** 请求记录承载统一时间和递归属性。这里的 timeout 是 Task 期限，
不是现有 Agent execution limit 或单轮治理 quota 的静默重命名。
准确 objectiveRevisionKey 已绑定时，准备策略不能使其换成别的 revision。

```json
{
  "ref": "reg-request-1",
  "targetKey": "target-1",
  "objectiveRevisionKey": "objective-revision-1",
  "desiredLevel": "terminal",
  "priority": 1,
  "origin": {
    "kind": "external"
  },
  "seriesId": "reg-request-1",
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "freshness": "completed-after-eligible",
  "timeoutMs": 300000,
  "deadlineAt": "2026-10-29T03:26:00.000Z",
  "recursive": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "preparationPolicy": {
    "leadMs": 10000,
    "fallback": "none"
  }
}
```

这是新记录形状的建议，不能直接加入历史 schema 1/2/3。
Regulation admission 如何统一接收浮动 URL、以及任务 timeout 与治理 quota 的优先级，
仍需在接口设计中明确，本例不假装这些接口已经存在。

## 3. 创建 Response：完整初始 Task 快照

### 3.1 Check 创建响应：accepted → pending

Before 的 POST 成功返回 HTTP 201、Location 和快照本身，没有额外 `{task: ...}` 包装。
After 建议保留这种响应方式；路由版本号另定，不在旧 endpoint 偷换语义。

**Before：**

```json
{
  "taskId": "check-task-1",
  "hostInstance": "host-a",
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
  "taskId": "check-task-1",
  "requestId": "check-request-1",
  "seriesId": "workspace-checks",
  "hostInstance": "host-a",
  "revision": 1,
  "state": "pending",
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "deadlineAt": "2026-10-29T03:21:30.000Z",
  "freshness": "completed-after-eligible",
  "recursive": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "preparation": {
    "state": "scheduled",
    "scheduledAt": "2026-10-29T03:20:50.000Z"
  }
}
```

### 3.2 Probe 创建响应：默认 series 和 eligible

**Before：**

```json
{
  "taskId": "probe-task-1",
  "hostInstance": "host-a",
  "revision": 1,
  "state": "accepted",
  "acceptedAt": "2026-10-29T03:20:00.000Z",
  "freshness": "started-after-request"
}
```

**After：** 对应 1.2；series 等于 request ID，eligible 等于 received。
计算出的准备时间早于接收，只能接收后立即安排，不伪造提前发生的下载。

```json
{
  "taskId": "probe-task-1",
  "requestId": "probe-request-1",
  "seriesId": "probe-request-1",
  "hostInstance": "host-a",
  "revision": 1,
  "state": "pending",
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:20:00.000Z",
  "deadlineAt": "2026-10-29T03:21:00.000Z",
  "freshness": "started-after-eligible",
  "recursive": {
    "periodMs": 60000,
    "anchor": "completed"
  },
  "preparation": {
    "state": "scheduled",
    "scheduledAt": "2026-10-29T03:20:00.000Z"
  }
}
```

## 4. 准备/回退及完成 Response

### 4.1 准备失败：failed → pending + 明确 fallback 证据

同一浮动来源更新下载失败，Before 没有 fallback；After 假定此前已有符合授权的准确旧版，
本轮明确允许回退。若旧版不存在或不再可用，After 也必须 failed。

**Before：**

```json
{
  "taskId": "check-task-1",
  "hostInstance": "host-a",
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

**After：** 03:20:52Z 完成回退，尚未 eligible，因此仍 pending；
准确旧版的选择来源与更新失败均可观察，没有顶层 failed error 冒充运行失败。
selected 是候选准确引用；artifact 元数据可在最终准入时出现，见下一例。

```json
{
  "taskId": "check-task-1",
  "requestId": "check-request-1",
  "seriesId": "workspace-checks",
  "hostInstance": "host-a",
  "revision": 3,
  "state": "pending",
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "deadlineAt": "2026-10-29T03:21:30.000Z",
  "freshness": "completed-after-eligible",
  "recursive": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "preparation": {
    "state": "fallback",
    "scheduledAt": "2026-10-29T03:20:50.000Z",
    "startedAt": "2026-10-29T03:20:50.000Z",
    "completedAt": "2026-10-29T03:20:52.000Z",
    "selected": {
      "kind": "checker",
      "url": "https://example.test/checker/latest.tgz",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "fallbackFromRequestId": "check-request-0",
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
  "taskId": "check-task-1",
  "hostInstance": "host-a",
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
      "languages": ["en"]
    }
  },
  "language": "en",
  "executionId": "check-execution-1",
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

**After：** Task 完成时间与 Execution 完成时间分开；旧内容的 checkedAt 保留原值，
本次更新尝试发生在 preparation 中，不把复用旧缓存记成成功更新。

```json
{
  "taskId": "check-task-1",
  "requestId": "check-request-1",
  "seriesId": "workspace-checks",
  "hostInstance": "host-a",
  "revision": 8,
  "state": "completed",
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:21:00.000Z",
  "deadlineAt": "2026-10-29T03:21:30.000Z",
  "completedAt": "2026-10-29T03:21:04.010Z",
  "freshness": "completed-after-eligible",
  "recursive": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "preparation": {
    "state": "fallback",
    "scheduledAt": "2026-10-29T03:20:50.000Z",
    "startedAt": "2026-10-29T03:20:50.000Z",
    "completedAt": "2026-10-29T03:20:52.000Z",
    "selected": {
      "kind": "checker",
      "url": "https://example.test/checker/latest.tgz",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "fallbackFromRequestId": "check-request-0",
    "updateError": {
      "code": "download_failed",
      "stage": "download",
      "message": "Artifact download failed."
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
      "languages": ["en"]
    }
  },
  "language": "en",
  "executionId": "check-execution-1",
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

**Before：**

```json
{
  "taskId": "probe-task-1",
  "hostInstance": "objective-host-a",
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
      "languages": ["en"],
      "levels": [
        {
          "id": "ready",
          "checks": ["pass"]
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
  "executionId": "probe-execution-1",
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
        "id": "observation-1",
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
        "id": "invocation-1",
        "observationId": "observation-1",
        "objective": {
          "kind": "objective",
          "url": "https://example.test/objective/v1.tgz",
          "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        },
        "level": "ready",
        "checker": "pass",
        "taskId": "child-task-1",
        "executionId": "child-execution-1",
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
        "invocationId": "invocation-1",
        "snapshot": {
          "taskId": "child-task-1",
          "hostInstance": "checker-host-a",
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
              "languages": ["en"]
            }
          },
          "language": "en",
          "executionId": "child-execution-1",
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

**After：** 根是 completed 锚点递归，child 不递归。根 Task.completedAt
比 Execution.completedAt 晚 10ms，下一轮锚定前者。
该例的 child 在父执行开始之后才受理，其 eligible 默认等于自身 received。
这里展示两个逻辑服务同机装配的时间，不用客户端时间跨远端服务仲裁。

```json
{
  "taskId": "probe-task-1",
  "requestId": "probe-request-1",
  "seriesId": "probe-request-1",
  "hostInstance": "objective-host-a",
  "revision": 18,
  "state": "completed",
  "receivedAt": "2026-10-29T03:20:00.000Z",
  "eligibleAt": "2026-10-29T03:20:00.000Z",
  "deadlineAt": "2026-10-29T03:21:00.000Z",
  "completedAt": "2026-10-29T03:20:01.110Z",
  "freshness": "started-after-eligible",
  "recursive": {
    "periodMs": 60000,
    "anchor": "completed"
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
      "languages": ["en"],
      "levels": [
        {
          "id": "ready",
          "checks": ["pass"]
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
  "executionId": "probe-execution-1",
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
        "id": "observation-1",
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
        "id": "invocation-1",
        "observationId": "observation-1",
        "objective": {
          "kind": "objective",
          "url": "https://example.test/objective/v1.tgz",
          "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        },
        "level": "ready",
        "checker": "pass",
        "taskId": "child-task-1",
        "executionId": "child-execution-1",
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
        "invocationId": "invocation-1",
        "snapshot": {
          "taskId": "child-task-1",
          "requestId": "child-request-1",
          "seriesId": "child-request-1",
          "hostInstance": "checker-host-a",
          "revision": 8,
          "state": "completed",
          "receivedAt": "2026-10-29T03:20:00.210Z",
          "eligibleAt": "2026-10-29T03:20:00.210Z",
          "deadlineAt": "2026-10-29T03:22:00.210Z",
          "completedAt": "2026-10-29T03:20:01.010Z",
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
              "languages": ["en"]
            }
          },
          "language": "en",
          "executionId": "child-execution-1",
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

## 5. 后继 Request 与系列规划记录

### 5.1 后继 Request：eligible 与 completed 两种完整例子

**Before：** Check/Probe 不自动生成后继，没有对应 Request 对象；
Coordinator 的旧 recurrence 已在第 2 节展示，不以 `{}` 冒充统一旧协议。

**After / eligible：** 第 1.1 轮的后继为 03:22:00Z，
仍用浮动来源并继承 series；不是拿最终旧 digest 替换后继的选版意图。
该请求由服务端生成，不能依赖客户端定时重发。

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
  "freshness": "completed-after-eligible",
  "timeoutMs": 30000,
  "eligibleAt": "2026-10-29T03:22:00.000Z",
  "seriesId": "workspace-checks",
  "recursive": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "preparationPolicy": {
    "leadMs": 10000,
    "fallback": "previous-usable"
  }
}
```

**After / completed：** 假定第 1.2 轮 Task 在 03:20:25Z completed，
其后继 eligible 为 03:21:25Z，不是旧 eligible 加一分钟。

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
  "freshness": "started-after-eligible",
  "timeoutMs": 60000,
  "eligibleAt": "2026-10-29T03:21:25.000Z",
  "seriesId": "probe-request-1",
  "recursive": {
    "periodMs": 60000,
    "anchor": "completed"
  },
  "preparationPolicy": {
    "leadMs": 10000,
    "fallback": "none"
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
  "seriesId": "workspace-checks",
  "pendingTaskId": "check-task-2",
  "pendingRequestId": "check-request-2",
  "generation": 2,
  "latestSuccessor": {
    "predecessorRequestId": "check-request-1",
    "successorRequestId": "check-request-2",
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
  "taskId": "check-task-2",
  "hostInstance": "host-a",
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
终态保留 scheduled preparation 信息不代表准备仍会启动。

```json
{
  "taskId": "check-task-2",
  "requestId": "check-request-2",
  "seriesId": "workspace-checks",
  "hostInstance": "host-a",
  "revision": 2,
  "state": "cancelled",
  "receivedAt": "2026-10-29T03:21:00.000Z",
  "eligibleAt": "2026-10-29T03:22:00.000Z",
  "deadlineAt": "2026-10-29T03:22:30.000Z",
  "freshness": "completed-after-eligible",
  "recursive": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "preparation": {
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

**After：** 已有 `check-task-2` 的情况下产生 `check-task-duplicate`；
保留原任务，新任务记录 cancelled。下面是第 6.1 用户取消之前的另一个分支场景。
`planningConflict` 是建议的诊断字段，保留任务必须与当前授权范围一致。

```json
{
  "taskId": "check-task-duplicate",
  "requestId": "check-request-duplicate",
  "seriesId": "workspace-checks",
  "hostInstance": "host-a",
  "revision": 2,
  "state": "cancelled",
  "receivedAt": "2026-10-29T03:21:00.100Z",
  "eligibleAt": "2026-10-29T03:22:00.000Z",
  "deadlineAt": "2026-10-29T03:22:30.000Z",
  "freshness": "completed-after-eligible",
  "recursive": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "error": {
    "code": "duplicate_planning",
    "stage": "schedule",
    "message": "An existing pending task retains the series planning slot."
  },
  "planningConflict": {
    "retainedTaskId": "check-task-2"
  }
}
```

## 7. Events：过滤请求与完整事件 payload

**Before：** `GET /events?taskId=check-task-1`，事件名 `task.updated`，
以下为一条完整 data payload；没有 series 过滤参数。

```json
{
  "taskId": "check-task-1",
  "snapshot": {
    "taskId": "check-task-1",
    "hostInstance": "host-a",
    "revision": 1,
    "state": "accepted",
    "acceptedAt": "2026-10-29T03:20:00.000Z",
    "freshness": "completed-after-request"
  }
}
```

**After：** 建议 `GET /events?seriesId=workspace-checks`；
即使订阅早于第二轮创建，也能收到第二轮的这一条完整 data payload。
事件名暂保留 task.updated，新查询的版本/过滤组合及游标协议待定。

```json
{
  "seriesId": "workspace-checks",
  "requestId": "check-request-2",
  "taskId": "check-task-2",
  "snapshot": {
    "taskId": "check-task-2",
    "requestId": "check-request-2",
    "seriesId": "workspace-checks",
    "hostInstance": "host-a",
    "revision": 1,
    "state": "pending",
    "receivedAt": "2026-10-29T03:21:00.000Z",
    "eligibleAt": "2026-10-29T03:22:00.000Z",
    "deadlineAt": "2026-10-29T03:22:30.000Z",
    "freshness": "completed-after-eligible",
    "recursive": {
      "periodMs": 60000,
      "anchor": "eligible"
    },
    "preparation": {
      "state": "scheduled",
      "scheduledAt": "2026-10-29T03:21:50.000Z"
    }
  }
}
```

相同事件 envelope 可承载准备更新、fallback、终态与恢复快照。
单轮 revision 不能用作整个 series 的全局游标；系列保留/分页设计仍需独立确定。

## 8. 持久记录与恢复 Response

### 8.1 未完成 Task 的逻辑持久记录

**Before：** Check/Probe 的 Task/Run 是含 Map、Promise、AbortController、timer
和服务内序号的内存对象，没有公开或持久化 JSON 记录。不能捏造一份旧存储格式来对照。
Coordinator 的持久事件已存在，不因此被删除或当作同形 Check/Probe 存储。

**After：** 以下展示一个尚未开始准备的 pending Check 的完整逻辑恢复单元，
含原 Request、服务端身份、期限、准备时间及前驱。字段布局只是建议，
不把授权 scope 或幂等信息作为公开 SSE 数据。
已选版/运行中的记录还需持久准确版本、执行环境及尝试证据，不在本例凭空填充。

```json
{
  "kind": "check-task",
  "scope": "local-owner",
  "requestId": "check-request-2",
  "taskId": "check-task-2",
  "seriesId": "workspace-checks",
  "predecessorRequestId": "check-request-1",
  "generation": 2,
  "request": {
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
    "seriesId": "workspace-checks",
    "recursive": {
      "periodMs": 60000,
      "anchor": "eligible"
    },
    "preparationPolicy": {
      "leadMs": 10000,
      "fallback": "previous-usable"
    }
  },
  "snapshot": {
    "taskId": "check-task-2",
    "requestId": "check-request-2",
    "seriesId": "workspace-checks",
    "hostInstance": "host-a",
    "revision": 1,
    "state": "pending",
    "receivedAt": "2026-10-29T03:21:00.000Z",
    "eligibleAt": "2026-10-29T03:22:00.000Z",
    "deadlineAt": "2026-10-29T03:22:30.000Z",
    "freshness": "completed-after-eligible",
    "recursive": {
      "periodMs": 60000,
      "anchor": "eligible"
    },
    "preparation": {
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
  "taskId": "check-task-2",
  "requestId": "check-request-2",
  "seriesId": "workspace-checks",
  "hostInstance": "host-b",
  "revision": 2,
  "state": "pending",
  "receivedAt": "2026-10-29T03:21:00.000Z",
  "eligibleAt": "2026-10-29T03:22:00.000Z",
  "deadlineAt": "2026-10-29T03:22:30.000Z",
  "freshness": "completed-after-eligible",
  "recursive": {
    "periodMs": 60000,
    "anchor": "eligible"
  },
  "preparation": {
    "state": "scheduled",
    "scheduledAt": "2026-10-29T03:21:50.000Z"
  },
  "recovery": {
    "previousHostInstance": "host-a",
    "recoveredAt": "2026-10-29T03:21:20.000Z"
  }
}
```

## 评审时不要由示例推定的事项

这些完整对象用于看清字段之间的关系，不是绕过待决项的定稿：

- `requestId` 是否独立于 `taskId`、旧 acceptedAt 如何迁移；
- recursive 双 anchor 的最终默认值、completed 模式无 pending 时如何停止；
- preparation 状态与到 eligible 尚未准备好的激活规则；
- fallback 旧版选择、最大陈旧度及 scope；
- 同 series 跨模块作用域、公共错误码/状态码及 HTTP/SDK 版本；
- durable schema、历史游标和运行中 Execution 的崩溃重试策略。

本次只新增文档示例，不提交生命周期接受事件，也不把这些 JSON 发给现有接口执行。
