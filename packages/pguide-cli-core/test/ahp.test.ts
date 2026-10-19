import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { test } from "node:test";
import {
  type AhpAgentProfile,
  type AhpSessionIdentity,
  executeAhp,
  inspectAhp,
  parseConfig,
  validateAgentProfile,
} from "@potential-guide/cli-core";
import { ahpHost } from "./ahp-fixture.js";

function profile(url: string): AhpAgentProfile {
  return {
    type: "ahp",
    connection: { protocolVersion: "1.0.0", agent: "generic-provider" },
    transport: { type: "websocket", url },
    requirements: { sessionResume: true },
  };
}

test("AHP connection deadline also covers a stalled WebSocket upgrade", async () => {
  const server = createServer();
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", () => undefined);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(
      executeAhp(
        profile(`ws://127.0.0.1:${address.port}`),
        "repair",
        process.cwd(),
        AbortSignal.timeout(100),
        { onSession: async () => undefined },
      ),
      /timeout|abort/i,
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

for (const bytes of [4 * 1024 * 1024, 4 * 1024 * 1024 + 1]) {
  test(`AHP enforces the exact incoming byte budget at ${bytes} bytes`, async () => {
    const host = await ahpHost({
      intercept(message, connection) {
        if (message.method !== "initialize") return false;
        const reply = {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "1.0.0",
            snapshots: [
              {
                resource: "ahp-root://",
                fromSeq: 0,
                state: { agents: [{ provider: "generic-provider" }] },
              },
            ],
          },
          padding: "",
        };
        reply.padding = "x".repeat(bytes - Buffer.byteLength(JSON.stringify(reply)));
        const raw = JSON.stringify(reply);
        assert.equal(Buffer.byteLength(raw), bytes);
        connection.raw(raw);
        return true;
      },
    });
    try {
      const invocation = inspectAhp(profile(host.url), AbortSignal.timeout(3000));
      if (bytes === 4 * 1024 * 1024) assert.equal((await invocation).provider, "generic-provider");
      else await assert.rejects(invocation, /output limit/);
    } finally {
      await host.close();
    }
  });
}

test("malformed AHP frames fail without leaking their payload to diagnostics", async () => {
  const host = await ahpHost({
    intercept(_message, connection) {
      connection.raw("untrusted-secret{invalid-json");
      return true;
    },
  });
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    await assert.rejects(
      inspectAhp(profile(host.url), AbortSignal.timeout(1000)),
      (error: Error) =>
        /malformed/.test(error.message) && !error.message.includes("untrusted-secret"),
    );
    assert.equal(warnings.length, 0);
  } finally {
    console.warn = warn;
    await host.close();
  }
});

test("top-level discriminants normalize only valid legacy ACP and reject mixed profiles", () => {
  const legacy = {
    connection: { type: "acp", protocolVersion: "1" },
    transport: { type: "stdio", command: "fixture" },
  };
  const normalized = validateAgentProfile(legacy);
  assert.deepEqual(normalized, {
    type: "acp",
    connection: { protocolVersion: "1" },
    transport: legacy.transport,
  });
  const ahp = profile("wss://host.example.invalid/ahp");
  const config = parseConfig(
    JSON.stringify({ schemaVersion: 2, agents: { old: legacy, new: normalized, remote: ahp } }),
  );
  assert.deepEqual(config.agents, { old: normalized, new: normalized, remote: ahp });
  for (const invalid of [
    { ...legacy, type: "acp" },
    { ...legacy, type: "ahp" },
    { ...legacy, connection: { protocolVersion: "1" } },
    { ...ahp, type: undefined },
    { ...ahp, connection: { ...ahp.connection, type: "ahp" } },
    { ...ahp, connection: { ...ahp.connection, protocolVersion: "1" } },
    { ...ahp, transport: legacy.transport },
    { ...normalized, transport: ahp.transport },
    { ...ahp, transport: { type: "websocket", url: "wss://host.invalid/?tkn=literal" } },
    { ...ahp, authentication: { type: "bearer", token: "literal" } },
  ])
    assert.throws(() => validateAgentProfile(invalid));
});

test("AHP external confirmation is explicit and cannot be configured on ACP", () => {
  const ahp = profile("wss://host.example.invalid/ahp");
  for (const confirmations of ["deny", "external"] as const)
    assert.deepEqual(validateAgentProfile({ ...ahp, confirmations }), { ...ahp, confirmations });
  for (const confirmations of ["approve", "always", true, {}, null])
    assert.throws(() => validateAgentProfile({ ...ahp, confirmations }), /confirmations/);
  assert.throws(
    () =>
      validateAgentProfile({
        type: "acp",
        connection: { protocolVersion: "1" },
        transport: { type: "stdio", command: "fixture" },
        confirmations: "external",
      }),
    /ACP.*confirmations/,
  );
});

for (const mode of ["permission", "result-permission"] as const) {
  for (const approved of [true, false]) {
    test(`AHP external ${mode} observes external ${approved ? "approval" : "denial"} without dispatching a decision`, async () => {
      const host = await ahpHost({
        mode,
        onPending(turnId, chatUri, connection) {
          setTimeout(() => {
            connection.action(chatUri, {
              type:
                mode === "permission" ? "chat/toolCallConfirmed" : "chat/toolCallResultConfirmed",
              turnId,
              toolCallId: "tool",
              approved,
              ...(approved ? { confirmed: "user-action" } : { reason: "denied" }),
            });
            connection.action(chatUri, { type: "chat/turnComplete", turnId, duration: 1 });
          }, 20);
        },
      });
      const pending: unknown[] = [];
      try {
        const outcome = await executeAhp(
          { ...profile(host.url), confirmations: "external" },
          "repair",
          process.cwd(),
          AbortSignal.timeout(2000),
          {
            onSession: async () => undefined,
            onPermission: async (request) => {
              pending.push(request);
            },
          },
        );
        assert.equal(outcome.status, "completed");
        assert.equal(outcome.permissionDenials, approved ? undefined : 1);
        assert.equal(pending.length, 1);
        assert.match(JSON.stringify(pending), /"sessionUri":"ahp-session:/);
        assert.match(JSON.stringify(pending), /"chatUri":"ahp-chat:/);
        assert.match(
          JSON.stringify(pending),
          mode === "permission" ? /"phase":"execution"/ : /"phase":"result"/,
        );
        assert.equal(
          host.messages.some(
            ({ method, params }) =>
              method === "dispatchAction" &&
              /toolCall(Result)?Confirmed/.test(String((params.action as { type: string }).type)),
          ),
          false,
        );
      } finally {
        await host.close();
      }
    });
  }
}

for (const mode of ["timeout", "abort", "foreign-turn", "disconnect"] as const) {
  test(`AHP external confirmation ${mode} stays bounded and never approves`, async () => {
    const controller = new AbortController();
    const updates: unknown[] = [];
    const host = await ahpHost({
      mode: "permission",
      onPending(_turnId, chatUri, connection) {
        if (mode === "foreign-turn") {
          connection.action(chatUri, {
            type: "chat/toolCallConfirmed",
            turnId: "foreign",
            toolCallId: "tool",
            approved: true,
            confirmed: "user-action",
          });
          connection.action(chatUri, {
            type: "chat/turnComplete",
            turnId: "foreign",
            duration: 1,
          });
        } else if (mode === "disconnect") setTimeout(() => connection.close(), 20);
      },
    });
    try {
      await assert.rejects(
        executeAhp(
          { ...profile(host.url), confirmations: "external" },
          "repair",
          process.cwd(),
          mode === "abort" ? controller.signal : AbortSignal.timeout(250),
          {
            onSession: async () => undefined,
            onPermission: async () => {
              if (mode === "abort") controller.abort(new Error("Cancelled by test"));
            },
            onUpdate: async (update) => {
              updates.push(update);
            },
          },
        ),
        mode === "disconnect" ? /uncertain|disconnect/i : /abort|timeout|cancelled/i,
      );
      assert.equal(
        host.messages.some(
          ({ method, params }) =>
            method === "dispatchAction" &&
            /toolCall(Result)?Confirmed/.test(String((params.action as { type: string }).type)),
        ),
        false,
      );
      assert.match(
        JSON.stringify(updates),
        mode === "disconnect" || mode === "abort"
          ? /"executionState":"uncertain"/
          : /"remoteStopConfirmed":true/,
      );
      assert.equal(
        host.messages.filter(
          ({ method, params }) =>
            method === "dispatchAction" &&
            (params.action as { type: string }).type === "chat/turnStarted",
        ).length,
        1,
      );
    } finally {
      await host.close();
    }
  });
}

test("AHP waits for Host completion, saves confirmed identity before dispatch, and resumes original chat", async () => {
  const host = await ahpHost();
  let identity: AhpSessionIdentity | undefined;
  const modes: string[] = [];
  const savedBeforeDispatch: boolean[] = [];
  const savedTurns = new Set<string>();
  try {
    const options = {
      onSession: async (next: AhpSessionIdentity, mode: string) => {
        identity = next;
        modes.push(mode);
        if (next.turnId && !savedTurns.has(next.turnId)) {
          savedTurns.add(next.turnId);
          savedBeforeDispatch.push(
            !host.messages.some(
              (message) =>
                message.method === "dispatchAction" &&
                (message.params.action as { turnId?: string }).turnId === next.turnId,
            ),
          );
        }
      },
    };
    assert.equal(
      (
        await executeAhp(
          profile(host.url),
          "complete observation",
          process.cwd(),
          AbortSignal.timeout(3000),
          options,
        )
      ).status,
      "completed",
    );
    assert.ok(identity?.sessionUri.startsWith("ahp-session:/"));
    assert.equal(identity?.chatUri, "ahp-chat:/host-default");
    assert.equal(
      (
        await executeAhp(
          profile(host.url),
          "fresh observation",
          "ignored-new-cwd",
          AbortSignal.timeout(3000),
          { ...options, session: identity, continuing: true },
        )
      ).status,
      "completed",
    );
    assert.equal(host.messages.filter(({ method }) => method === "createSession").length, 1);
    assert.deepEqual(savedBeforeDispatch, [true, true]);
    assert.ok(modes.includes("resumed"));
    const dispatch = host.messages.filter(
      ({ method, params }) =>
        method === "dispatchAction" &&
        (params.action as { type: string }).type === "chat/turnStarted",
    );
    assert.equal(dispatch.length, 2);
    assert.ok(dispatch[0]);
    assert.equal(
      (dispatch[0].params.action as { message: { text: string } }).message.text,
      "complete observation",
    );
  } finally {
    await host.close();
  }
});

test("AHP Host authority chat URIs persist unchanged and deferred backends accept their first turn before ready", async () => {
  const host = await ahpHost({ authorityChat: true, deferredReady: true });
  let identity: AhpSessionIdentity | undefined;
  const saved: AhpSessionIdentity[] = [];
  const options = {
    onSession: async (value: AhpSessionIdentity) => {
      identity = value;
      saved.push(value);
    },
  };
  try {
    assert.equal(
      (
        await executeAhp(
          profile(host.url),
          "first turn initializes backend",
          process.cwd(),
          AbortSignal.timeout(2000),
          options,
        )
      ).status,
      "completed",
    );
    assert.ok(identity?.chatUri);
    const expectedChat = `ahp-chat://default/${Buffer.from(identity.sessionUri).toString("base64url")}`;
    assert.equal(identity.chatUri, expectedChat);
    assert.ok(saved.some((value) => value.chatUri === expectedChat && value.turnId));
    assert.equal(
      (
        await executeAhp(
          profile(host.url),
          "resume original chat",
          process.cwd(),
          AbortSignal.timeout(2000),
          { ...options, session: identity, continuing: true },
        )
      ).status,
      "completed",
    );
    assert.equal(host.messages.filter(({ method }) => method === "createSession").length, 1);
    assert.equal(
      host.messages.filter(
        ({ method, params }) =>
          method === "dispatchAction" &&
          (params.action as { type: string }).type === "chat/turnStarted",
      ).length,
      2,
    );
    assert.ok(
      host.messages
        .filter(
          ({ method, params }) =>
            method === "subscribe" && String(params.channel).startsWith("ahp-chat:"),
        )
        .every(({ params }) => params.channel === expectedChat),
    );
    const before = host.messages.length;
    for (const chatUri of [
      "https://default/session",
      "ahp-session:/not-a-chat",
      "ahp-chat:relative",
      "ahp-chat://default/",
      "ahp-chat://user:secret@default/session",
      "ahp-chat://default/session?token=value",
      "ahp-chat://default/session#fragment",
      "ahp-chat://default/%zz",
      "ahp-chat://default/with space",
    ]) {
      await assert.rejects(
        executeAhp(
          profile(host.url),
          "must not dispatch",
          process.cwd(),
          AbortSignal.timeout(1000),
          { ...options, session: { ...identity, chatUri } },
        ),
        /Invalid.*identity/,
      );
    }
    assert.equal(host.messages.length, before);
    await assert.rejects(
      executeAhp(
        profile(host.url),
        "must not switch chat",
        process.cwd(),
        AbortSignal.timeout(1000),
        { ...options, session: { ...identity, chatUri: "ahp-chat://other/unrelated" } },
      ),
      /original\/default chat is unavailable/,
    );
    assert.equal(
      host.messages.filter(
        ({ method, params }) =>
          method === "dispatchAction" &&
          (params.action as { type: string }).type === "chat/turnStarted",
      ).length,
      2,
    );
  } finally {
    await host.close();
  }
});

test("AHP resumes a confirmed but unstarted creating session without allocating a replacement", async () => {
  const host = await ahpHost({ authorityChat: true, deferredReady: true });
  let identity: AhpSessionIdentity | undefined;
  try {
    await assert.rejects(
      executeAhp(profile(host.url), "not sent", process.cwd(), AbortSignal.timeout(1500), {
        onSession: async (value) => {
          identity = value;
          throw new Error("simulated interruption after confirmed create");
        },
      }),
      /simulated interruption/,
    );
    assert.ok(identity);
    assert.equal(identity.chatUri, undefined);
    assert.equal(identity.turnId, undefined);
    assert.equal(
      host.messages.some(({ method }) => method === "dispatchAction"),
      false,
    );
    const modes: string[] = [];
    assert.equal(
      (
        await executeAhp(
          profile(host.url),
          "first real send",
          process.cwd(),
          AbortSignal.timeout(1500),
          {
            session: identity,
            continuing: true,
            onSession: async (_value, mode) => {
              modes.push(mode);
            },
          },
        )
      ).status,
      "completed",
    );
    assert.ok(modes.every((mode) => mode === "resumed"));
    assert.equal(host.messages.filter(({ method }) => method === "createSession").length, 1);
  } finally {
    await host.close();
  }
});

for (const fault of ["failed", "invalid", "provider", "directory"] as const) {
  test(`AHP deferred session ${fault} does not bypass execution preconditions`, async () => {
    let directory = "";
    const host = await ahpHost({
      deferredReady: true,
      authorityChat: true,
      intercept(message, connection) {
        if (message.method === "resourceResolve") directory = String(message.params.uri);
        if (
          message.method !== "subscribe" ||
          !String(message.params.channel).startsWith("ahp-session:")
        )
          return false;
        const chatUri = `ahp-chat://default/${Buffer.from(String(message.params.channel)).toString("base64url")}`;
        connection.send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            snapshot: {
              resource: message.params.channel,
              fromSeq: 0,
              state: {
                lifecycle:
                  fault === "failed" ? "failed" : fault === "invalid" ? "unknown" : "creating",
                provider: fault === "provider" ? "other" : "generic-provider",
                workingDirectories: [fault === "directory" ? "file:///other" : directory],
                defaultChat: chatUri,
                chats: [{ resource: chatUri }],
                activeClients: [],
              },
            },
          },
        });
        return true;
      },
    });
    try {
      await assert.rejects(
        executeAhp(profile(host.url), "do not send", process.cwd(), AbortSignal.timeout(1500), {
          onSession: async () => undefined,
        }),
        /creation failed|invalid session snapshot|differs from the pinned/,
      );
      assert.equal(
        host.messages.some(({ method }) => method === "dispatchAction"),
        false,
      );
    } finally {
      await host.close();
    }
  });
}

test("AHP diagnosis validates without creating a session and sends only advertised resource credentials", async () => {
  const host = await ahpHost();
  process.env.PGUIDE_AHP_TEST_TOKEN = "fixture-secret";
  try {
    const candidate: AhpAgentProfile = {
      ...profile(host.url),
      authentication: {
        type: "query-token",
        parameter: "tkn",
        tokenEnv: "PGUIDE_AHP_TEST_TOKEN",
        resources: [
          { resource: "https://resource.example.invalid", tokenEnv: "PGUIDE_AHP_TEST_TOKEN" },
        ],
      },
    };
    assert.equal(
      (await inspectAhp(candidate, AbortSignal.timeout(2000))).provider,
      "generic-provider",
    );
    assert.match(host.requestUrl, /tkn=fixture-secret/);
    assert.equal(host.messages.filter(({ method }) => method === "authenticate").length, 1);
    assert.equal(
      host.messages.some(({ method }) => method === "createSession"),
      false,
    );
    await assert.rejects(
      inspectAhp(
        {
          ...candidate,
          authentication: {
            type: "none",
            resources: [{ resource: "https://other.invalid", tokenEnv: "PGUIDE_AHP_TEST_TOKEN" }],
          },
        },
        AbortSignal.timeout(2000),
      ),
      /not advertised/,
    );
    assert.equal(host.messages.filter(({ method }) => method === "authenticate").length, 1);
  } finally {
    delete process.env.PGUIDE_AHP_TEST_TOKEN;
    await host.close();
  }
});

for (const mode of [
  "error",
  "input",
  "permission",
  "result-permission",
  "disconnect",
  "hang",
] as const) {
  test(`AHP ${mode} is explicit and does not replay`, async () => {
    const host = await ahpHost({ mode });
    const updates: unknown[] = [];
    let identity: AhpSessionIdentity | undefined;
    const options = {
      onSession: async (value: AhpSessionIdentity) => {
        identity = value;
      },
      onUpdate: async (update: unknown) => {
        updates.push(update);
      },
    };
    try {
      const result = executeAhp(
        profile(host.url),
        "repair",
        process.cwd(),
        AbortSignal.timeout(mode === "hang" ? 100 : 2000),
        options,
      );
      if (mode === "disconnect" || mode === "hang")
        await assert.rejects(result, /uncertain|abort|timeout/i);
      else {
        const outcome = await result;
        if (mode === "permission" || mode === "result-permission") {
          assert.equal(outcome.permissionDenials, 1);
          assert.equal(
            host.messages.some(
              ({ method, params }) =>
                method === "dispatchAction" &&
                (params.action as { type: string; approved?: boolean }).type ===
                  (mode === "permission"
                    ? "chat/toolCallConfirmed"
                    : "chat/toolCallResultConfirmed") &&
                (params.action as { approved?: boolean }).approved === false,
            ),
            true,
          );
        } else assert.notEqual(outcome.status, "completed");
        if (mode === "error") assert.match(outcome.summary, /fixture: Host failure/);
      }
      assert.equal(
        host.messages.filter(
          ({ method, params }) =>
            method === "dispatchAction" &&
            (params.action as { type: string }).type === "chat/turnStarted",
        ).length,
        1,
      );
      assert.ok(identity?.turnId);
      if (mode === "hang" || mode === "disconnect") {
        assert.match(JSON.stringify(updates), /remoteStopConfirmed/);
        assert.match(
          JSON.stringify(updates),
          mode === "disconnect" ? /uncertain/ : /"remoteStopConfirmed":true/,
        );
      }
      if (mode === "disconnect")
        await assert.rejects(
          executeAhp(profile(host.url), "do not replay", process.cwd(), AbortSignal.timeout(2000), {
            ...options,
            session: identity,
            continuing: true,
          }),
          /active|uncertain/,
        );
    } finally {
      await host.close();
    }
  });
}

test("AHP initialization cancellation covers setup, missing identities and protocol/auth failures are explicit", async () => {
  const host = await ahpHost({
    intercept(message) {
      return message.method === "initialize";
    },
  });
  const options = { onSession: async () => undefined };
  try {
    await assert.rejects(
      executeAhp(profile(host.url), "repair", process.cwd(), AbortSignal.timeout(100), options),
      /abort|timeout|closed/i,
    );
    await assert.rejects(
      executeAhp(profile(host.url), "repair", process.cwd(), AbortSignal.timeout(100), {
        ...options,
        continuing: true,
      }),
      /no real AHP session/,
    );
    await assert.rejects(
      executeAhp(
        {
          ...profile(host.url),
          authentication: { type: "query-token", parameter: "tkn", tokenEnv: "PGUIDE_AHP_MISSING" },
        },
        "repair",
        process.cwd(),
        AbortSignal.timeout(100),
        options,
      ),
      /requires environment/,
    );
    assert.equal(
      host.messages.some(({ method }) => method === "createSession"),
      false,
    );
  } finally {
    await host.close();
  }
});

for (const code of [-32007, -32002, -32005]) {
  test(`AHP error ${code} is explicit and sanitized`, async () => {
    process.env.PGUIDE_AHP_TEST_ERROR = "fixture-secret";
    const host = await ahpHost({
      intercept(message, connection) {
        if (message.method !== "initialize") return false;
        connection.send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code, message: "fixture-secret rejected" },
        });
        return true;
      },
    });
    try {
      await assert.rejects(
        inspectAhp(
          {
            ...profile(host.url),
            authentication: {
              type: "query-token",
              parameter: "tkn",
              tokenEnv: "PGUIDE_AHP_TEST_ERROR",
            },
          },
          AbortSignal.timeout(1000),
        ),
        (error: Error) => !error.message.includes("fixture-secret") && /failed/.test(error.message),
      );
    } finally {
      delete process.env.PGUIDE_AHP_TEST_ERROR;
      await host.close();
    }
  });
}
test("AHP resume refuses lost sessions without allocating replacements", async () => {
  const host = await ahpHost();
  try {
    await assert.rejects(
      executeAhp(profile(host.url), "do not replace", process.cwd(), AbortSignal.timeout(2000), {
        session: {
          sessionUri: "ahp-session:/missing",
          chatUri: "ahp-chat:/missing",
          workingDirectory: "file:///missing",
        },
        onSession: async () => undefined,
      }),
      /not found/,
    );
    assert.equal(
      host.messages.some(({ method }) => method === "createSession"),
      false,
    );
  } finally {
    await host.close();
  }
});

test("AHP explicitly marks optional continuation with no identity as new", async () => {
  const host = await ahpHost();
  const modes: string[] = [];
  try {
    const result = await executeAhp(
      { ...profile(host.url), requirements: { sessionResume: false } },
      "repair",
      process.cwd(),
      AbortSignal.timeout(2000),
      {
        continuing: true,
        onSession: async (_identity, mode) => {
          modes.push(mode);
        },
      },
    );
    assert.equal(result.status, "completed");
    assert.ok(modes.every((mode) => mode === "new-without-session-id"));
  } finally {
    await host.close();
  }
});

for (const invalid of [
  "version",
  "agent",
  "directory",
  "snapshot",
  "rejected",
  "unknown-turn",
] as const) {
  test(`AHP rejects ${invalid} before reporting execution success`, async () => {
    const host = await ahpHost({
      intercept(message, connection) {
        const reply = (result: unknown) =>
          connection.send({ jsonrpc: "2.0", id: message.id, result });
        if (invalid === "version" && message.method === "initialize") {
          reply({ protocolVersion: "99.0.0", snapshots: [] });
          return true;
        }
        if (invalid === "directory" && message.method === "resourceResolve") {
          reply({ uri: message.params.uri, type: "file" });
          return true;
        }
        if (invalid === "snapshot" && message.method === "subscribe") {
          reply({ snapshot: { resource: message.params.channel, fromSeq: 0, state: {} } });
          return true;
        }
        if (message.method === "dispatchAction" && invalid === "rejected") {
          connection.send({
            jsonrpc: "2.0",
            method: "action",
            params: {
              channel: message.params.channel,
              action: message.params.action,
              serverSeq: 1,
              rejectionReason: "Permission denied",
            },
          });
          return true;
        }
        return false;
      },
    });
    try {
      const candidate =
        invalid === "agent"
          ? {
              ...profile(host.url),
              connection: { ...profile(host.url).connection, agent: "unavailable" },
            }
          : profile(host.url);
      const options =
        invalid === "unknown-turn"
          ? {
              session: {
                sessionUri: "ahp-session:/missing",
                chatUri: "ahp-chat:/missing",
                workingDirectory: "file:///missing",
                turnId: "unconfirmed",
              },
              onSession: async () => undefined,
            }
          : { onSession: async () => undefined };
      await assert.rejects(
        executeAhp(candidate, "repair", process.cwd(), AbortSignal.timeout(2000), options),
        /unsupported|unavailable|directory|snapshot|rejected|not found/,
      );
      assert.equal(
        host.messages.filter(({ method }) => method === "createSession").length <= 1,
        true,
      );
    } finally {
      await host.close();
    }
  });
}

test("AHP ignores duplicate/old notifications and rejects an unconfirmed previous dispatch", async () => {
  let turnId = "";
  const host = await ahpHost({
    intercept(message, connection) {
      if (message.method !== "dispatchAction") return false;
      const action = message.params.action as Record<string, unknown>;
      if (action.type !== "chat/turnStarted") return false;
      turnId = String(action.turnId);
      connection.action(String(message.params.channel), action);
      const complete = {
        jsonrpc: "2.0",
        method: "action",
        params: {
          channel: message.params.channel,
          serverSeq: 2,
          action: { type: "chat/turnComplete", turnId, duration: 1 },
        },
      };
      connection.send(complete);
      connection.send(complete);
      connection.send({ ...complete, params: { ...complete.params, serverSeq: 1 } });
      return true;
    },
  });
  let identity: AhpSessionIdentity | undefined;
  try {
    assert.equal(
      (
        await executeAhp(profile(host.url), "repair", process.cwd(), AbortSignal.timeout(2000), {
          onSession: async (next) => {
            identity = next;
          },
        })
      ).status,
      "completed",
    );
    assert.ok(turnId);
    assert.ok(identity);
    await assert.rejects(
      executeAhp(profile(host.url), "do not replay", process.cwd(), AbortSignal.timeout(2000), {
        session: identity,
        onSession: async () => undefined,
      }),
      /no confirmed terminal turn/,
    );
    assert.equal(
      host.messages.filter(
        ({ method, params }) =>
          method === "dispatchAction" &&
          (params.action as { type: string }).type === "chat/turnStarted",
      ).length,
      1,
    );
  } finally {
    await host.close();
  }
});
