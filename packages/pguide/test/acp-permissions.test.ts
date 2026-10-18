import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { AcpPermissionRequest } from "@potential-guide/cli-core";
import type { AgentInput, RegulationPermissions } from "@potential-guide/objective-regulator";
import { createAcpPermissionPolicy } from "../src/acp-permissions.js";
import { executeAcpAgent } from "../src/commands/regulator.js";
import { scratch } from "./fixtures.js";

const signal = () => new AbortController().signal;
function request(toolCall: Record<string, unknown>): AcpPermissionRequest {
  return {
    sessionId: "fixture",
    toolCall: { toolCallId: "untrusted-secret", ...toolCall },
    options: [
      { optionId: "once", name: "Yes", kind: "allow_once" },
      { optionId: "always", name: "Always", kind: "allow_always" },
      { optionId: "no", name: "No", kind: "reject_once" },
    ],
  };
}
function permission(path: string): RegulationPermissions {
  return { ceiling: [{ id: "file", operation: "edit", resources: [path] }], grants: ["file"] };
}

function createDiff(path: string): string {
  const target = path.replaceAll("\\", "/");
  return `\ndiff --git a/${target} b/${target}\ncreate file mode 100644\nindex 0000000..0000000\n--- a/dev/null\n+++ b/${target}\n@@ -1,0 +1,2 @@\n+PERMISSION_DIAGNOSTIC\n+\n\n`;
}

test("Copilot fileName/unified-diff permissions verify every path before allowing once", async () => {
  const cwd = await mkdtemp(join(scratch, "permission-copilot-diff-"));
  try {
    const path = join(cwd, "marker.txt");
    const other = join(cwd, "other.txt");
    const policy = await createAcpPermissionPolicy(
      {
        ceiling: [{ id: "files", operation: "edit", resources: [path, other] }],
        grants: ["files"],
      },
      cwd,
    );
    const tool = {
      kind: "edit",
      title: "Create file",
      status: "pending",
      locations: [{ path }],
      rawInput: { fileName: path, diff: createDiff(path) },
    };
    assert.equal(await policy.handler(request(tool), signal()), "once");
    const target = path.replaceAll("\\", "/");
    const update = `diff --git a/${target} b/${target}\nindex 1111111..2222222 100644\n--- a/${target}\n+++ b/${target}\n@@ -1 +1 @@\n-before\n+after\n`;
    const deletion = `diff --git a/${target} b/${target}\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/${target}\n+++ /dev/null\n@@ -1 +0,0 @@\n-before\n`;
    for (const diff of [update, deletion])
      assert.equal(
        await policy.handler(request({ ...tool, rawInput: { fileName: path, diff } }), signal()),
        "once",
      );
    const invalid = [
      { ...tool, rawInput: { fileName: other, diff: createDiff(path) } },
      { ...tool, locations: [{ path: other }] },
      { ...tool, locations: [{ path }, { path: other }] },
      { ...tool, rawInput: { fileName: path, diff: createDiff(path) + createDiff(other) } },
      {
        ...tool,
        rawInput: {
          fileName: path,
          diff: createDiff(path).replace(`+++ b/${target}`, `+++ b/${other.replaceAll("\\", "/")}`),
        },
      },
      {
        ...tool,
        rawInput: {
          fileName: path,
          diff: createDiff(path).replace(`b/${target}`, `b/${other.replaceAll("\\", "/")}`),
        },
      },
      {
        ...tool,
        rawInput: {
          fileName: path,
          diff: createDiff(path).replace(
            "create file mode 100644",
            `rename from ${target}\nrename to ${target}`,
          ),
        },
      },
      { ...tool, rawInput: { fileName: path, diff: createDiff(path).replace("100644", "120000") } },
      {
        ...tool,
        rawInput: {
          fileName: path,
          diff: createDiff(path).replace("+PERMISSION_DIAGNOSTIC\n", ""),
        },
      },
      { ...tool, rawInput: { fileName: path, diff: createDiff(path), command: "unaccounted" } },
      { ...tool, rawInput: { fileName: path, diff: "GIT binary patch" } },
    ];
    for (const entry of invalid)
      assert.equal(await policy.handler(request(entry), signal()), undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ACP permissions default deny, require explicit subset and snapshot mutable input", async () => {
  const cwd = await mkdtemp(join(scratch, "permission-default-"));
  try {
    const path = join(cwd, "marker");
    const edit = request({ kind: "edit", rawInput: { path, content: "yes" } });
    const denied = await createAcpPermissionPolicy(undefined, cwd);
    assert.equal(await denied.handler(edit, signal()), undefined);
    assert.equal(denied.denied.length, 1);
    await assert.rejects(
      createAcpPermissionPolicy({ ceiling: [], grants: ["self-approved"] }, cwd),
    );
    const configured = permission(path);
    const policy = await createAcpPermissionPolicy(configured, cwd);
    (configured.grants as string[]).length = 0;
    assert.equal(await policy.handler(edit, signal()), "once");
    assert.deepEqual(policy.denied, []);
    assert.equal(
      await policy.handler(
        { ...edit, options: [{ optionId: "always", name: "Always", kind: "allow_always" }] },
        signal(),
      ),
      undefined,
    );
    const aborted = new AbortController();
    aborted.abort();
    assert.equal(await policy.handler(edit, aborted.signal), undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("resource extraction checks every path and rejects ambiguity, traversal, siblings and missing parents", async () => {
  const cwd = await mkdtemp(join(scratch, "permission-paths-"));
  try {
    const path = join(cwd, "marker");
    const policy = await createAcpPermissionPolicy(permission(path), cwd);
    assert.equal(
      await policy.handler(
        request({ kind: "edit", locations: [{ path }], rawInput: { path, content: "yes" } }),
        signal(),
      ),
      "once",
    );
    const invalid = [
      { kind: "edit" },
      { kind: "other", locations: [{ path }] },
      { kind: "edit", locations: [{ path }, { path: `${path}-sibling` }] },
      { kind: "edit", locations: [{ path }], rawInput: { path, command: "anything" } },
      { kind: "edit", locations: [{ path }], rawInput: "arbitrary shell text" },
      { kind: "edit", locations: [{ path }], rawInput: { path, paths: [`${path}-other`] } },
      { kind: "edit", locations: [{ path: join(cwd, "absent", "marker") }] },
      { kind: "edit", locations: [{ path: `${cwd}\\nested\\..\\marker` }] },
      { kind: "edit", locations: [{ path: cwd }] },
      { kind: "read", locations: [{ path }] },
      { kind: "edit", locations: [{ path }, {}] },
    ];
    for (const tool of invalid)
      assert.equal(await policy.handler(request(tool), signal()), undefined, JSON.stringify(tool));
    const directory = await createAcpPermissionPolicy(permission(cwd), cwd);
    assert.equal(
      await directory.handler(request({ kind: "edit", locations: [{ path }] }), signal()),
      undefined,
    );
    const missing = await createAcpPermissionPolicy(permission(join(cwd, "absent", "marker")), cwd);
    assert.equal(
      await missing.handler(
        request({ kind: "edit", locations: [{ path: join(cwd, "absent", "marker") }] }),
        signal(),
      ),
      undefined,
    );
    const read = await createAcpPermissionPolicy(
      { ceiling: [{ id: "r", operation: "read", resources: [path] }], grants: ["r"] },
      cwd,
    );
    assert.equal(
      await read.handler(request({ kind: "read", rawInput: { path } }), signal()),
      "once",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("apply_patch checks add, update, delete, every move and every metadata location", async () => {
  const cwd = await mkdtemp(join(scratch, "permission-patch-"));
  try {
    const path = join(cwd, "marker");
    const policy = await createAcpPermissionPolicy(permission(path), cwd);
    for (const body of [
      "*** Add File: marker\n+new",
      "*** Update File: marker\n@@\n-old\n+new",
      "*** Delete File: marker",
    ]) {
      assert.equal(
        await policy.handler(
          request({ kind: "edit", rawInput: `*** Begin Patch\n${body}\n*** End Patch` }),
          signal(),
        ),
        "once",
      );
    }
    for (const body of [
      "*** Add File: marker\n+new\n*** Add File: outside\n+other",
      "*** Update File: marker\n*** Move to: outside\n@@\n-old\n+new",
      "*** Update File: marker\n*** Move to: ../outside\n@@\n-old\n+new",
      "*** Update File: marker\n*** Execute: shell",
      "*** Delete File: marker\n*** Move to: marker",
      "*** Add File: marker\nunrecognized content",
    ]) {
      assert.equal(
        await policy.handler(
          request({
            kind: "edit",
            locations: [{ path }],
            rawInput: `*** Begin Patch\n${body}\n*** End Patch`,
          }),
          signal(),
        ),
        undefined,
      );
    }
    const move = await createAcpPermissionPolicy(
      {
        ceiling: [{ id: "move", operation: "edit", resources: [path, join(cwd, "renamed")] }],
        grants: ["move"],
      },
      cwd,
    );
    assert.equal(
      await move.handler(
        request({
          kind: "edit",
          rawInput:
            "*** Begin Patch\n*** Update File: marker\n*** Move to: renamed\n@@\n-old\n+new\n*** End Patch",
        }),
        signal(),
      ),
      "once",
    );
    assert.equal(
      await policy.handler(
        request({
          kind: "edit",
          locations: [{ path: join(cwd, "outside") }],
          rawInput: "*** Begin Patch\n*** Delete File: marker\n*** End Patch",
        }),
        signal(),
      ),
      undefined,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("canonical snapshots detect changed symlink parents instead of granting escaped targets", async () => {
  const cwd = await mkdtemp(join(scratch, "permission-link-"));
  try {
    const parent = join(cwd, "parent");
    const outside = join(cwd, "outside");
    await mkdir(parent);
    await mkdir(outside);
    await writeFile(join(outside, "marker"), "private");
    const path = join(parent, "marker");
    const policy = await createAcpPermissionPolicy(permission(path), cwd);
    await rm(parent, { recursive: true });
    await symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
    assert.equal(
      await policy.handler(request({ kind: "edit", rawInput: { path, content: "no" } }), signal()),
      undefined,
    );
    assert.equal(
      await policy.handler(
        request({ kind: "edit", rawInput: { path: join(outside, "marker"), content: "no" } }),
        signal(),
      ),
      undefined,
    );
    const laterInvocation = await createAcpPermissionPolicy(permission(path), cwd);
    assert.equal(
      await laterInvocation.handler(
        request({ kind: "edit", rawInput: { path, content: "no" } }),
        signal(),
      ),
      undefined,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("execution requires exact complete command, never a cwd, shell prefix or wildcard", async () => {
  const command = "node verify.mjs --token=secret-command";
  const decisions: unknown[] = [];
  const policy = await createAcpPermissionPolicy(
    { ceiling: [{ id: "verify", operation: "execute", command }], grants: ["verify"] },
    scratch,
    (event) => decisions.push(event),
  );
  assert.equal(
    await policy.handler(request({ kind: "execute", rawInput: { command } }), signal()),
    "once",
  );
  for (const rawInput of [
    { command: `${command} && arbitrary` },
    { command: "node" },
    { cwd: scratch },
    { command, cwd: scratch },
    { command: "node *" },
    command,
  ])
    assert.equal(await policy.handler(request({ kind: "execute", rawInput }), signal()), undefined);
  assert.doesNotMatch(JSON.stringify(decisions), /secret-command|untrusted-secret/);
});

test("dangling final symlinks cannot masquerade as authorized new files", async (context) => {
  const cwd = await mkdtemp(join(scratch, "permission-dangling-"));
  try {
    const path = join(cwd, "marker");
    const policy = await createAcpPermissionPolicy(permission(path), cwd);
    try {
      await symlink(join(cwd, "outside"), path, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip("Creating file symlinks requires platform privileges.");
        return;
      }
      throw error;
    }
    assert.equal(
      await policy.handler(request({ kind: "edit", rawInput: { path, content: "no" } }), signal()),
      undefined,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ACP invocation allows an authorized alternative after denial without killing the prompt", async () => {
  const cwd = await mkdtemp(join(scratch, "permission-alternative-"));
  const path = join(cwd, "marker");
  const input: AgentInput = {
    binding: { id: "fixture" },
    subject: {},
    permissions: permission(path),
    target: { objectiveId: "git+file:///fixture.git#pilot.yaml", levelId: "terminal" },
    observation: {
      current: { objectiveId: "git+file:///fixture.git#pilot.yaml", levelId: "initial" },
      problems: [],
      gapSummary: "",
      observedAt: new Date().toISOString(),
      versions: {},
    },
    limits: { timeoutMs: 10000 },
  };
  const updates: unknown[] = [];
  try {
    const outcome = await executeAcpAgent(
      input,
      signal(),
      {
        connection: { type: "acp", protocolVersion: "1" },
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [
            "--input-type=module",
            "-e",
            `import{createInterface}from"node:readline";import{writeFile}from"node:fs/promises";
let prompt;function ask(id,toolCall){console.log(JSON.stringify({jsonrpc:"2.0",id,method:"session/request_permission",params:{sessionId:"s",toolCall:{toolCallId:"tool",...toolCall},options:[{optionId:"allow",name:"Allow",kind:"allow_once"}]}}));}
for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);
if(m.method==="session/prompt"){prompt=m;ask("unsafe",{kind:"execute",title:"secret-rationale",rawInput:{command:"unsafe --password=secret-command"}});continue;}
if(m.id==="unsafe"){if(m.result.outcome.outcome!=="cancelled")throw Error("Unsafe command allowed");ask("safe",{kind:"edit",rawInput:{path:${JSON.stringify(path)},content:"yes"}});continue;}
if(m.id==="safe"){if(m.result.outcome.optionId!=="allow")throw Error("Alternative denied");await writeFile(${JSON.stringify(path)},"yes");console.log(JSON.stringify({jsonrpc:"2.0",id:prompt.id,result:{stopReason:"end_turn"}}));continue;}
if(m.id!==undefined)console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result:m.method==="initialize"?{protocolVersion:1}:m.method==="session/new"?{sessionId:"s"}:{}}));}`,
          ],
        },
      },
      cwd,
      async (update) => {
        updates.push(update);
      },
    );
    assert.equal(outcome.status, "completed");
    assert.equal(await readFile(path, "utf8"), "yes");
    if (outcome.status !== "completed") assert.fail("Expected completed alternative");
    assert.equal(outcome.authorizationRequests?.length, 1);
    assert.equal(outcome.authorizationRequests?.[0]?.operation, "execute");
    assert.doesNotMatch(JSON.stringify({ outcome, updates }), /secret-command|secret-rationale/);
    assert.match(JSON.stringify(updates), /allowed-once/);
    assert.match(JSON.stringify(updates), /denied/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
