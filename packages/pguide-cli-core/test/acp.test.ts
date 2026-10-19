import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AcpClient,
  type AcpClientOptions,
  type AcpUpdate,
  type LegacyAcpAgentProfile,
  acpProtocolVersion,
  validateAgentProfile,
} from "@potential-guide/cli-core";

function profile(script: string): LegacyAcpAgentProfile {
  return {
    connection: { type: "acp", protocolVersion: "1" },
    transport: { type: "stdio", command: process.execPath, args: ["-e", script] },
  };
}

const rpcPrelude = `
const { createInterface } = require("node:readline");
const send = message => console.log(JSON.stringify({jsonrpc:"2.0", ...message}));
`;

test("optional ACP raw output bound covers stdout and stderr without waiting for a newline", async () => {
  for (const stream of ["stdout", "stderr"]) {
    const client = new AcpClient(
      profile(`process.stdin.once("data",()=>process.${stream}.write("x".repeat(64)));`),
      undefined,
      { maxOutputBytes: 32 },
    );
    try {
      await assert.rejects(client.initialize("1"), /ACP output limit exceeded/);
    } finally {
      await client.stop();
    }
  }
  for (const maxOutputBytes of [0, -1, 1.1, Number.POSITIVE_INFINITY])
    assert.throws(
      () => new AcpClient(profile(""), undefined, { maxOutputBytes }),
      /positive safe integer/,
    );
});

test("strict ACP completion requires explicit end_turn while legacy default is unchanged", async () => {
  for (const requireEndTurn of [false, true]) {
    for (const stopReason of [undefined, "max_tokens", "end_turn"]) {
      const client = new AcpClient(
        profile(`${rpcPrelude}
createInterface({input:process.stdin}).on("line", line => {
 const m=JSON.parse(line);
 send({id:m.id,result:${JSON.stringify({ stopReason })}});
});`),
        undefined,
        { requireEndTurn },
      );
      try {
        assert.equal(
          (await client.prompt("fixture", "one tiny task")).status,
          !requireEndTurn || stopReason === "end_turn" ? "completed" : "blocked",
        );
      } finally {
        await client.stop();
      }
    }
  }
});

test("ACP configuration stays a positive safe integer string", () => {
  assert.equal(acpProtocolVersion("1"), 1);
  assert.equal(acpProtocolVersion("9007199254740991"), Number.MAX_SAFE_INTEGER);
  for (const value of ["", "0", "-1", "1.5", "1e0", " 1", "01", "9007199254740992"]) {
    assert.throws(() => acpProtocolVersion(value), /positive safe integer/);
    assert.throws(() =>
      validateAgentProfile({
        ...profile(""),
        connection: { type: "acp", protocolVersion: value },
      }),
    );
  }
  assert.throws(() =>
    validateAgentProfile({ ...profile(""), connection: { type: "acp", protocolVersion: 1 } }),
  );
});

test("ACP initializes using numeric protocol version and loads a standard session", async () => {
  const client = new AcpClient(
    profile(`${rpcPrelude}
createInterface({input:process.stdin}).on("line", line => {
  const m=JSON.parse(line);
  if(m.method==="initialize"){
    if(m.params.protocolVersion!==1) throw Error("Expected numeric ACP version");
    if(Object.keys(m.params.clientCapabilities).length) throw Error("Unexpected capabilities");
    send({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
  } else if(m.method==="session/load" && m.params.sessionId==="saved" && Array.isArray(m.params.mcpServers)){
    send({id:m.id,result:{}});
  } else send({id:m.id,error:{code:-32601,message:"Unexpected method"}});
});`),
  );
  try {
    assert.equal((await client.initialize("1")).protocolVersion, 1);
    await client.resumeSession("saved", process.cwd());
  } finally {
    await client.stop();
  }
});

test("ACP rejects absent, string, mismatched, and unsafe negotiated versions", async () => {
  for (const version of [undefined, "1", 0, -1, 1.5, 2, Number.MAX_SAFE_INTEGER + 1]) {
    const client = new AcpClient(
      profile(`${rpcPrelude}
createInterface({input:process.stdin}).on("line", line => {
 const m=JSON.parse(line);
 send({id:m.id,result:${JSON.stringify({ protocolVersion: version })}});
});`),
    );
    try {
      await assert.rejects(client.initialize("1"), /unsupported version/);
    } finally {
      await client.stop();
    }
  }
});

function permissionAgent(
  method = "session/request_permission",
  overrides: Record<string, unknown> = {},
  requestId?: string,
): LegacyAcpAgentProfile {
  return profile(`${rpcPrelude}
let promptId;
createInterface({input:process.stdin}).on("line", line => {
 const m=JSON.parse(line);
 if(m.method==="initialize") return send({id:m.id,result:{protocolVersion:1}});
 if(m.method==="session/new") return send({id:m.id,result:{sessionId:"fixture"}});
 if(m.method==="session/prompt"){
   promptId=m.id;
   return send({id:${requestId === undefined ? "m.id" : JSON.stringify(requestId)},
     method:${JSON.stringify(method)},params:{
       sessionId:"fixture",toolCall:{toolCallId:"write-1",kind:"edit",title:"Write a file"},
       options:[{optionId:"allow",name:"Allow once",kind:"allow_once"}],
       ...${JSON.stringify(overrides)}
     }});
 }
 if(!m.method && promptId!==undefined){
   send({method:"session/update",params:{sessionId:"other",update:{
     sessionUpdate:"agent_message_chunk",content:{type:"text",text:"IGNORE"}
   }}});
   send({method:"session/update",params:{sessionId:"fixture",update:{
     sessionUpdate:"agent_message_chunk",content:{type:"text",text:JSON.stringify(m)}
   }}});
   send({id:promptId,result:{stopReason:"end_turn"}});
 }
});`);
}

async function permissionResponse(
  agent = permissionAgent(),
  options?: AcpClientOptions,
): Promise<{ reply: Record<string, unknown>; updates: AcpUpdate[] }> {
  const client = new AcpClient(agent, undefined, options);
  try {
    await client.initialize("1");
    const id = await client.newSession(process.cwd());
    const result = await client.prompt(id, "Test permission handling");
    assert.equal(result.status, "completed");
    return { reply: JSON.parse(result.summary), updates: client.updates };
  } finally {
    await client.stop();
  }
}

test("default permission cancellation does not steal a colliding pending prompt ID", async () => {
  const { reply, updates } = await permissionResponse();
  assert.deepEqual(reply, {
    jsonrpc: "2.0",
    id: 3,
    result: { outcome: { outcome: "cancelled" } },
  });
  assert.ok(updates.some((update) => update.method === "pguide/request_denied"));
});

test("unsupported client filesystem requests fail closed with matching string IDs", async () => {
  const { reply } = await permissionResponse(
    permissionAgent("fs/write_text_file", { path: "not-authorized", content: "no" }, "agent-1"),
  );
  assert.deepEqual(reply, {
    jsonrpc: "2.0",
    id: "agent-1",
    error: { code: -32601, message: "Client method not supported." },
  });
});

test("explicit permission handler may select only an offered option", async () => {
  const { reply } = await permissionResponse(permissionAgent(), {
    permissionHandler(request, signal) {
      assert.equal(request.sessionId, "fixture");
      assert.equal(request.toolCall.toolCallId, "write-1");
      assert.equal(signal.aborted, false);
      return "allow";
    },
  });
  assert.deepEqual(reply.result, { outcome: { outcome: "selected", optionId: "allow" } });
  for (const permissionHandler of [
    () => undefined,
    () => "unknown",
    () => {
      throw new Error("policy failed");
    },
    () => Promise.reject(new Error("async policy failed")),
  ]) {
    const { reply } = await permissionResponse(permissionAgent(), { permissionHandler });
    assert.deepEqual(reply.result, { outcome: { outcome: "cancelled" } });
  }
});

test("invalid or inactive-session permission requests never invoke the handler", async () => {
  for (const overrides of [
    { sessionId: "unknown" },
    { toolCall: {} },
    { options: [] },
    { options: [{ optionId: "allow", name: "Allow", kind: "unknown" }] },
    {
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "allow", name: "Allow", kind: "allow_always" },
      ],
    },
  ]) {
    let called = false;
    const { reply } = await permissionResponse(
      permissionAgent("session/request_permission", overrides),
      {
        permissionHandler() {
          called = true;
          return "allow";
        },
      },
    );
    assert.equal(called, false);
    assert.deepEqual(reply.result, { outcome: { outcome: "cancelled" } });
  }
});

test("permission decisions are bounded and timed-out handlers receive cancellation", async () => {
  let handlerSignal: AbortSignal | undefined;
  const { reply, updates } = await permissionResponse(permissionAgent(), {
    permissionTimeoutMs: 20,
    permissionHandler(_request, signal) {
      handlerSignal = signal;
      return new Promise(() => {});
    },
  });
  assert.equal(handlerSignal?.aborted, true);
  assert.deepEqual(reply.result, { outcome: { outcome: "cancelled" } });
  assert.ok(
    updates.some(
      (update) =>
        update.method === "pguide/request_denied" &&
        (update.params as { reason: string }).reason === "permission-handler-cancelled",
    ),
  );
  for (const permissionTimeoutMs of [0, -1, 0.5, 30_001]) {
    assert.throws(
      () => new AcpClient(profile(""), undefined, { permissionTimeoutMs }),
      /permissionTimeoutMs/,
    );
  }
});

test("ACP collects only current-session Agent text chunks and resets between prompts", async () => {
  const client = new AcpClient(
    profile(`${rpcPrelude}
let prompts=0;
createInterface({input:process.stdin}).on("line", line => {
 const m=JSON.parse(line);
 if(m.method==="initialize") return send({id:m.id,result:{protocolVersion:1}});
 if(m.method==="session/prompt"){
   for(const text of ["Agent ",String(++prompts)]) send({method:"session/update",params:{
     sessionId:m.params.sessionId,update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text}}
   }});
   send({id:m.id,result:{stopReason:"end_turn",summary:"legacy nonstandard summary"}});
 }
});`),
  );
  try {
    await client.initialize("1");
    assert.equal((await client.prompt("fixture", "one")).summary, "Agent 1");
    assert.equal((await client.prompt("fixture", "two")).summary, "Agent 2");
  } finally {
    await client.stop();
  }
});

test("ACP prompt text accumulation fails closed at its byte limit", async () => {
  const client = new AcpClient(
    profile(`${rpcPrelude}
createInterface({input:process.stdin}).on("line", line => {
 const m=JSON.parse(line);
 if(m.method==="session/prompt"){
   send({method:"session/update",params:{sessionId:m.params.sessionId,
     update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"x".repeat(1048577)}}}});
   send({id:m.id,result:{stopReason:"end_turn"}});
 }
});`),
  );
  try {
    await assert.rejects(client.prompt("fixture", "one"), /output limit exceeded/);
  } finally {
    await client.stop();
  }
});

test("client shutdown aborts an outstanding permission handler without waiting for its timeout", async () => {
  let notifyStarted: (signal: AbortSignal) => void = () => {};
  const started = new Promise<AbortSignal>((resolveStarted) => {
    notifyStarted = resolveStarted;
  });
  const client = new AcpClient(permissionAgent(), undefined, {
    permissionTimeoutMs: 30_000,
    permissionHandler(_request, signal) {
      notifyStarted(signal);
      return new Promise(() => {});
    },
  });
  try {
    await client.initialize("1");
    const id = await client.newSession(process.cwd());
    const failed = assert.rejects(client.prompt(id, "one"), /closed/);
    const signal = await started;
    await client.stop();
    await failed;
    assert.equal(signal.aborted, true);
  } finally {
    await client.stop();
  }
});
