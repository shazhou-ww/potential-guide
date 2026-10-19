import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type ChatAction,
  type ChatState,
  type ChatTurnCancelledAction,
  type ChatTurnStartedAction,
  type ChatToolCallDeniedAction,
  type ChatToolCallResultConfirmedAction,
  chatReducer,
  MessageKind,
  type SessionAction,
  type SessionState,
  type Snapshot,
  type StateAction,
  sessionReducer,
} from "@microsoft/agent-host-protocol";
import {
  AhpClient,
  type AhpTransport,
  RpcError,
  type Subscription,
} from "@microsoft/agent-host-protocol/client";
import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { type AhpAgentProfile, CliError, redactAgentValue } from "./index.js";

export interface AhpSessionIdentity {
  sessionUri: string;
  chatUri?: string;
  workingDirectory: string;
  turnId?: string;
}

export interface AhpExecutionOptions {
  session?: AhpSessionIdentity;
  continuing?: boolean;
  onSession(
    identity: AhpSessionIdentity,
    mode: "new" | "resumed" | "new-without-session-id",
  ): Promise<void>;
  onUpdate?(update: unknown): Promise<void>;
  onPermission?(request: {
    sessionUri: string;
    chatUri: string;
    turnId: string;
    toolCallId: string;
    phase: "execution" | "result";
  }): Promise<void>;
}

export interface AhpExecutionResult {
  status: "completed" | "blocked" | "failed";
  summary: string;
  text?: string;
  permissionDenials?: number;
}

function strictTransport(socket: WebSocket): AhpTransport {
  const transport = WebSocketTransport.fromSocket(socket);
  let bytes = 0;
  return {
    send: (message) =>
      transport.send(typeof message === "string" ? message : JSON.stringify(message)),
    close: () => transport.close(),
    async recv() {
      const frame = await transport.recv();
      if (frame === null) return null;
      if (frame.kind !== "text") throw new Error("AHP requires JSON-RPC text frames.");
      bytes += Buffer.byteLength(frame.text);
      if (bytes > 4 * 1024 * 1024) throw new Error("AHP execution output limit exceeded (4 MiB).");
      try {
        const message: unknown = JSON.parse(frame.text);
        if (
          !message ||
          typeof message !== "object" ||
          Array.isArray(message) ||
          !("jsonrpc" in message) ||
          message.jsonrpc !== "2.0" ||
          !(
            ("method" in message && typeof message.method === "string") ||
            ("id" in message && ("result" in message || "error" in message))
          )
        )
          throw new Error("Invalid JSON-RPC envelope.");
        return frame;
      } catch {
        throw new Error(
          "AHP Host sent a malformed JSON-RPC frame; connection closed without logging its payload.",
        );
      }
    },
  };
}

function isChatAction(action: StateAction): action is ChatAction {
  return action.type.startsWith("chat/");
}

function isSessionAction(action: StateAction): action is SessionAction {
  return action.type.startsWith("session/");
}

function safeText(value: string, profile: AhpAgentProfile): string {
  return redactAgentValue(value, profile);
}

function sessionSnapshot(snapshot: Snapshot | undefined, uri: string): SessionState {
  const state = snapshot?.state;
  if (
    !state ||
    snapshot?.resource !== uri ||
    !Number.isSafeInteger(snapshot.fromSeq) ||
    snapshot.fromSeq < 0 ||
    !("chats" in state) ||
    !Array.isArray(state.chats) ||
    !["creating", "ready", "failed"].includes(state.lifecycle)
  )
    throw new CliError("AHP subscribe returned an invalid session snapshot.", 6, "ahp-error");
  return state;
}

function chatSnapshot(snapshot: Snapshot | undefined, uri: string): ChatState {
  const state = snapshot?.state;
  if (
    !state ||
    snapshot?.resource !== uri ||
    !Number.isSafeInteger(snapshot.fromSeq) ||
    snapshot.fromSeq < 0 ||
    !("turns" in state) ||
    state.resource !== uri ||
    !Array.isArray(state.turns) ||
    !Array.isArray(state.activeTurn?.responseParts ?? [])
  )
    throw new CliError("AHP subscribe returned an invalid chat snapshot.", 6, "ahp-error");
  return state;
}

function requireToken(name: string): string {
  const token = process.env[name];
  if (!token)
    throw new CliError(`AHP authentication requires environment variable ${name}.`, 6, "ahp-error");
  return token;
}

function createSocket(profile: AhpAgentProfile): WebSocket {
  const url = new URL(profile.transport.url);
  if (profile.authentication?.type === "query-token")
    url.searchParams.set(
      profile.authentication.parameter,
      requireToken(profile.authentication.tokenEnv),
    );
  return new WebSocket(url);
}

async function waitSocket(socket: WebSocket, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolveOpen, rejectOpen) => {
    const done = () => {
      socket.removeEventListener("open", opened);
      socket.removeEventListener("error", errored);
      socket.removeEventListener("close", closed);
      signal.removeEventListener("abort", cancelled);
    };
    const opened = () => {
      done();
      resolveOpen();
    };
    const errored = () => {
      done();
      rejectOpen(
        new Error("AHP WebSocket connection failed (check endpoint and transport authentication)."),
      );
    };
    const closed = () => {
      done();
      rejectOpen(new Error("AHP WebSocket closed before initialization."));
    };
    const cancelled = () => {
      done();
      socket.close();
      rejectOpen(signal.reason);
    };
    socket.addEventListener("open", opened, { once: true });
    socket.addEventListener("error", errored, { once: true });
    socket.addEventListener("close", closed, { once: true });
    signal.addEventListener("abort", cancelled, { once: true });
    if (signal.aborted) cancelled();
  });
}

async function initializeAhp(client: AhpClient, profile: AhpAgentProfile) {
  const initialized = await client.initialize({
    clientId: randomUUID(),
    protocolVersions: [profile.connection.protocolVersion],
    initialSubscriptions: ["ahp-root://"],
  });
  if (
    initialized.protocolVersion !== profile.connection.protocolVersion ||
    !Array.isArray(initialized.snapshots)
  )
    throw new Error(
      "AHP Host negotiated an unsupported protocol version or invalid initialization.",
    );
  const root = initialized.snapshots.find(({ resource }) => resource === "ahp-root://")?.state;
  if (!root || !("agents" in root) || !Array.isArray(root.agents))
    throw new Error("AHP Host did not return an Agent capability catalogue.");
  const agent = root.agents.find(({ provider }) => provider === profile.connection.agent);
  if (!agent)
    throw new Error("AHP configured Agent is unavailable; choose an advertised provider.");
  for (const resource of profile.authentication?.resources ?? []) {
    if (!agent.protectedResources?.some((entry) => entry.resource === resource.resource))
      throw new Error(
        "AHP credential resource was not advertised by the selected Agent; credential was not sent.",
      );
    await client.request("authenticate", {
      channel: "ahp-root://",
      resource: resource.resource,
      token: requireToken(resource.tokenEnv),
    });
  }
  return {
    protocolVersion: initialized.protocolVersion,
    serverInfo: initialized.serverInfo,
    provider: agent.provider,
    capabilities: agent.capabilities,
  };
}

export async function inspectAhp(profile: AhpAgentProfile, signal: AbortSignal) {
  signal.throwIfAborted();
  const socket = createSocket(profile);
  let client: AhpClient | undefined;
  const abort = () => {
    if (client) void client.shutdown();
    else socket.close();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await waitSocket(socket, signal);
    client = new AhpClient(strictTransport(socket), { requestTimeoutMs: 0 });
    client.connect();
    return redactAgentValue(await initializeAhp(client, profile), profile);
  } catch (error) {
    throw new CliError(
      safeText(
        `AHP diagnosis failed: ${error instanceof Error ? error.message : "invalid response"}`,
        profile,
      ),
      6,
      "ahp-error",
    );
  } finally {
    signal.removeEventListener("abort", abort);
    if (client) await client.shutdown();
    else socket.close();
  }
}

function validChatUri(value: unknown): value is string {
  if (typeof value !== "string" || /[\p{Cc}\s\\]/u.test(value) || /%(?![\da-f]{2})/i.test(value))
    return false;
  try {
    const uri = new URL(value);
    return (
      uri.protocol === "ahp-chat:" &&
      uri.pathname.startsWith("/") &&
      uri.pathname.length > 1 &&
      !uri.username &&
      !uri.password &&
      !uri.search &&
      !uri.hash
    );
  } catch {
    return false;
  }
}

function validIdentity(identity: AhpSessionIdentity, profile: AhpAgentProfile): void {
  if (
    !identity ||
    typeof identity.sessionUri !== "string" ||
    !/^ahp-session:\/[^/?#]+$/.test(identity.sessionUri) ||
    typeof identity.workingDirectory !== "string" ||
    !identity.workingDirectory.startsWith("file:") ||
    (identity.chatUri !== undefined && !validChatUri(identity.chatUri)) ||
    (identity.turnId !== undefined &&
      (typeof identity.turnId !== "string" || !identity.turnId.trim())) ||
    safeText(JSON.stringify(identity), profile) !== JSON.stringify(identity)
  )
    throw new CliError(
      "Invalid or credential-bearing persisted AHP session identity.",
      6,
      "ahp-error",
    );
}

/**
 * One connection, one owned turn. No automatic reconnect or side-effect replay.
 * The caller supplies the execution-wide deadline, including connection setup.
 */
export async function executeAhp(
  profile: AhpAgentProfile,
  prompt: string,
  cwd: string,
  signal: AbortSignal,
  options: AhpExecutionOptions,
): Promise<AhpExecutionResult> {
  signal.throwIfAborted();
  if (options.session !== undefined) validIdentity(options.session, profile);
  if (options.continuing && !options.session && profile.requirements?.sessionResume)
    throw new CliError(
      "Cannot continue: no real AHP session identity was persisted; start a new regulation.",
      6,
      "ahp-error",
    );
  const socket = createSocket(profile);
  let client: AhpClient | undefined;
  let identity = options.session;
  let stage = "connection";
  let sessionState: SessionState | undefined;
  let chatState: ChatState | undefined;
  let ownedTurn: string | undefined;
  let sent = false;
  let terminal = false;
  let failure: Error | undefined;
  let caught: CliError | undefined;
  let outcome: AhpExecutionResult | undefined;
  let cancellationSent = false;
  let cancellationConfirmed = false;
  let permissionDenials = 0;
  const waiters = new Set<() => void>();
  const work: Promise<void>[] = [];
  const wake = () => {
    for (const waiter of [...waiters]) waiter();
  };
  const fail = (error: unknown) => {
    failure ??= error instanceof Error ? error : new Error("AHP event processing failed.");
    wake();
  };
  const update = async (value: unknown) => {
    await options.onUpdate?.(redactAgentValue(value, profile));
  };
  const cancel = () => {
    if (!client || !identity?.chatUri || !ownedTurn || !sent || terminal || cancellationSent)
      return;
    cancellationSent = true;
    try {
      client.dispatch(identity.chatUri, {
        type: "chat/turnCancelled" as ChatTurnCancelledAction["type"],
        turnId: ownedTurn,
        duration: 0,
      });
    } catch (error) {
      fail(error);
    }
  };
  const abort = () => {
    cancel();
    fail(
      new Error(
        "AHP local wait ended; remote stop is not confirmed until the Host acknowledges cancellation.",
      ),
    );
    if (client && !sent) void client.shutdown().catch(fail);
    else if (!client) socket.close();
  };
  signal.addEventListener("abort", abort, { once: true });
  const waitFor = <T>(read: () => T | undefined): Promise<T> =>
    new Promise((resolveWait, rejectWait) => {
      const check = () => {
        try {
          if (signal.aborted) throw signal.reason;
          if (failure) throw failure;
          const value = read();
          if (value !== undefined) {
            waiters.delete(check);
            resolveWait(value);
          }
        } catch (error) {
          waiters.delete(check);
          rejectWait(error);
        }
      };
      waiters.add(check);
      check();
    });
  const monitor = (subscription: Subscription, snapshot: Snapshot, kind: "session" | "chat") => {
    let seq = snapshot.fromSeq;
    const task = (async () => {
      for await (const event of subscription) {
        if (event.type === "authRequired")
          throw new Error("AHP authentication expired; refresh configured resource credentials.");
        if (event.type !== "action") continue;
        const envelope = event.params;
        if (!Number.isSafeInteger(envelope.serverSeq))
          throw new Error("AHP action has an invalid serverSeq.");
        if (envelope.serverSeq <= seq) continue;
        seq = envelope.serverSeq;
        if (envelope.rejectionReason)
          throw new Error(`AHP action rejected: ${envelope.rejectionReason}`);
        const action = envelope.action;
        if (
          ["chat/turnComplete", "chat/turnCancelled", "chat/error"].includes(action.type) &&
          (!("turnId" in action) ||
            typeof action.turnId !== "string" ||
            !action.turnId ||
            !("duration" in action) ||
            typeof action.duration !== "number" ||
            !Number.isFinite(action.duration) ||
            action.duration < 0)
        )
          throw new Error("AHP returned an invalid terminal turn action.");
        if (kind === "session") {
          if (isSessionAction(action) && sessionState)
            sessionState = sessionReducer(sessionState, action);
          if (action.type === "session/creationFailed")
            throw new Error("AHP session backend initialization failed.");
        } else if (chatState && isChatAction(action)) {
          if ("turnId" in action && ownedTurn && action.turnId !== ownedTurn) continue;
          chatState = chatReducer(chatState, action, (message) => {
            throw new Error(`AHP invalid state transition: ${message}`);
          });
          if (
            profile.confirmations === "external" &&
            (action.type === "chat/toolCallConfirmed" ||
              action.type === "chat/toolCallResultConfirmed") &&
            action.turnId === ownedTurn &&
            action.approved === false
          )
            permissionDenials += 1;
          if (
            (action.type === "chat/toolCallReady" || action.type === "chat/toolCallComplete") &&
            ownedTurn === action.turnId
          ) {
            const part = chatState.activeTurn?.responseParts.find(
              (part) => part.kind === "toolCall" && part.toolCall.toolCallId === action.toolCallId,
            );
            if (
              part?.kind === "toolCall" &&
              (part.toolCall.status === "pending-confirmation" ||
                part.toolCall.status === "pending-result-confirmation")
            ) {
              const phase =
                part.toolCall.status === "pending-confirmation" ? "execution" : "result";
              if (!client || !identity?.chatUri)
                throw new Error("AHP permission request has no active owned chat.");
              await options.onPermission?.({
                sessionUri: identity.sessionUri,
                chatUri: identity.chatUri,
                turnId: action.turnId,
                toolCallId: action.toolCallId,
                phase,
              });
              signal.throwIfAborted();
              if (profile.confirmations !== "external") {
                permissionDenials += 1;
                if (phase === "execution")
                  client.dispatch(identity.chatUri, {
                    type: "chat/toolCallConfirmed" as ChatToolCallDeniedAction["type"],
                    turnId: action.turnId,
                    toolCallId: action.toolCallId,
                    approved: false,
                    reason: "denied" as ChatToolCallDeniedAction["reason"],
                  });
                else
                  client.dispatch(identity.chatUri, {
                    type: "chat/toolCallResultConfirmed" as ChatToolCallResultConfirmedAction["type"],
                    turnId: action.turnId,
                    toolCallId: action.toolCallId,
                    approved: false,
                  });
              }
            }
          }
          if (action.type === "chat/turnCancelled" && action.turnId === ownedTurn)
            cancellationConfirmed = true;
        }
        wake();
        await update({ method: "action", params: envelope });
      }
      if (!terminal)
        throw new Error(
          sent
            ? "AHP disconnected after dispatch; execution state is uncertain. Do not replay; explicitly continue after checking the original session."
            : "AHP disconnected.",
        );
    })().catch(fail);
    work.push(task);
  };
  try {
    await waitSocket(socket, signal);
    client = new AhpClient(strictTransport(socket), { requestTimeoutMs: 0 });
    client.connect();
    const eventClient = client;
    work.push(
      (async () => {
        for await (const { event } of eventClient.events()) {
          if (event.type === "authRequired") {
            fail(new Error("AHP authentication expired; refresh configured resource credentials."));
            await eventClient.shutdown();
          }
        }
      })().catch(fail),
    );
    stage = "initialize";
    await initializeAhp(client, profile);
    signal.throwIfAborted();
    stage = "working-directory";
    const requestedDirectory = identity?.workingDirectory ?? pathToFileURL(resolve(cwd)).href;
    const directory = await client.resourceResolve({ uri: requestedDirectory });
    if (directory.type !== "directory" || !directory.uri?.startsWith("file:"))
      throw new Error(
        "AHP Host cannot resolve the requested working directory; repair was not sent.",
      );
    if (identity && directory.uri !== identity.workingDirectory)
      throw new Error("AHP restored working directory no longer resolves to the pinned directory.");
    const mode = identity ? "resumed" : options.continuing ? "new-without-session-id" : "new";
    stage = identity ? "restore-session" : "create-session";
    if (!identity) {
      const sessionUri = `ahp-session:/${randomUUID()}`;
      await client.request("createSession", {
        channel: sessionUri,
        provider: profile.connection.agent,
        workingDirectories: [directory.uri],
      });
      identity = { sessionUri, workingDirectory: directory.uri };
      await options.onSession(identity, mode);
    }
    signal.throwIfAborted();
    const sessionSubscription = await client.subscribe(identity.sessionUri);
    sessionState = sessionSnapshot(sessionSubscription.result.snapshot, identity.sessionUri);
    const snapshot = sessionSubscription.result.snapshot;
    if (!snapshot) throw new Error("AHP session snapshot is missing.");
    monitor(sessionSubscription.subscription, snapshot, "session");
    await waitFor(() => {
      if (sessionState?.lifecycle === "failed") throw new Error("AHP session creation failed.");
      const chat = identity?.chatUri ?? sessionState?.defaultChat;
      return sessionState?.lifecycle === "ready" ||
        (sessionState?.lifecycle === "creating" &&
          chat &&
          sessionState.chats.some(({ resource }) => resource === chat))
        ? true
        : undefined;
    });
    if (
      sessionState.provider !== profile.connection.agent ||
      sessionState.workingDirectories?.length !== 1 ||
      sessionState.workingDirectories[0] !== directory.uri
    )
      throw new Error(
        "AHP session provider or working directory differs from the pinned execution target.",
      );
    const chatUri = identity.chatUri ?? sessionState.defaultChat;
    if (!chatUri || !sessionState.chats.some(({ resource }) => resource === chatUri))
      throw new Error(
        "AHP original/default chat is unavailable; no replacement session or chat was created.",
      );
    identity = { ...identity, chatUri };
    validIdentity(identity, profile);
    await options.onSession(identity, mode);
    stage = "restore-chat";
    const chatSubscription = await client.subscribe(chatUri);
    chatState = chatSnapshot(chatSubscription.result.snapshot, chatUri);
    const chat = chatSubscription.result.snapshot;
    if (!chat) throw new Error("AHP chat snapshot is missing.");
    monitor(chatSubscription.subscription, chat, "chat");
    if (sessionState.lifecycle === "creating" && chatState.turns.length > 0)
      throw new Error(
        "AHP creating session already has turn history; wait for backend readiness before another execution.",
      );
    if (
      chatState.workingDirectories !== undefined &&
      (chatState.workingDirectories.length !== 1 ||
        chatState.workingDirectories[0] !== directory.uri)
    )
      throw new Error("AHP chat working directory differs from the pinned execution target.");
    if (
      chatState.activeTurn ||
      (chatState.queuedMessages?.length ?? 0) > 0 ||
      chatState.steeringMessage
    )
      throw new Error(
        "AHP original chat has active or queued execution; state is uncertain. Check that execution has stopped before explicitly continuing.",
      );
    if (
      identity.turnId &&
      !chatState.turns.some(
        (turn) =>
          turn.id === identity?.turnId && ["complete", "cancelled", "error"].includes(turn.state),
      )
    )
      throw new Error(
        "AHP previous dispatch has no confirmed terminal turn in retained history; execution state is uncertain. Do not replay.",
      );
    if (chatState.backgroundWork?.length)
      throw new Error(
        "AHP original chat still has background work; confirm it has stopped before continuing.",
      );
    stage = "execute";
    ownedTurn = randomUUID();
    identity = { ...identity, turnId: ownedTurn };
    await options.onSession(identity, mode);
    signal.throwIfAborted();
    sent = true;
    client.dispatch(chatUri, {
      type: "chat/turnStarted" as ChatTurnStartedAction["type"],
      turnId: ownedTurn,
      startedAt: new Date().toISOString(),
      message: { text: prompt, origin: { kind: MessageKind.User } },
    });
    const result = await waitFor(() => {
      if (
        sessionState?.provider !== profile.connection.agent ||
        sessionState.workingDirectories?.length !== 1 ||
        sessionState.workingDirectories[0] !== directory.uri ||
        (chatState?.workingDirectories !== undefined &&
          (chatState.workingDirectories.length !== 1 ||
            chatState.workingDirectories[0] !== directory.uri))
      )
        throw new Error("AHP execution target changed during the turn.");
      const turn = chatState?.turns.find(({ id }) => id === ownedTurn);
      if (turn) {
        if (!["complete", "cancelled", "error"].includes(turn.state))
          throw new Error("AHP returned an invalid terminal turn state.");
        terminal = true;
        return {
          status: turn.state === "complete" ? ("completed" as const) : ("failed" as const),
          summary:
            turn.state === "complete"
              ? "AHP Host confirmed turn completion; target must be re-observed."
              : `AHP Agent ${profile.connection.agent} (session ${identity?.sessionUri}) turn ${turn.state}: ${
                  turn.responseParts
                    .filter((part) => part.kind === "error")
                    .map((part) => `${part.error.errorType}: ${part.error.message}`)
                    .join("; ") || "Host confirmed the turn did not complete successfully."
                }`,
          text: turn.responseParts
            .filter((part) => part.kind === "markdown")
            .map((part) => part.content)
            .join(""),
          ...(permissionDenials === 0 ? {} : { permissionDenials }),
        };
      }
      const active = chatState?.activeTurn;
      if (
        active?.responseParts.some(
          (part) =>
            part.kind === "inputRequest" ||
            (part.kind === "toolCall" && part.toolCall.status === "auth-required"),
        )
      )
        return {
          status: "blocked" as const,
          summary: `AHP Agent ${profile.connection.agent} (session ${identity?.sessionUri}) requires input or tool approval; pguide does not automatically approve permissions.`,
        };
      return undefined;
    });
    if (result.status === "blocked") cancel();
    signal.throwIfAborted();
    outcome = redactAgentValue(result, profile);
  } catch (error) {
    const cause = signal.aborted ? signal.reason : error;
    const category =
      cause instanceof RpcError && cause.code === -32007
        ? "authentication required"
        : cause instanceof Error
          ? cause.message
          : "invocation failed";
    caught = new CliError(
      safeText(
        `AHP ${stage} failed for Agent ${profile.connection.agent}${identity ? ` (session ${identity.sessionUri})` : ""}: ${category}`,
        profile,
      ),
      6,
      "ahp-error",
    );
  } finally {
    signal.removeEventListener("abort", abort);
    try {
      if (sent && !terminal) {
        cancel();
        if (
          cancellationSent &&
          !cancellationConfirmed &&
          client?.connectionState.status === "connected"
        ) {
          await new Promise<void>((done) => {
            const check = () => {
              if (cancellationConfirmed) {
                clearTimeout(timer);
                waiters.delete(check);
                done();
              }
            };
            const timer = setTimeout(() => {
              waiters.delete(check);
              done();
            }, 250);
            waiters.add(check);
            check();
          });
        }
        await update({
          method: "pguide/ahp-interruption",
          params: {
            session: identity,
            cancellationSent,
            remoteStopConfirmed: cancellationConfirmed,
            executionState: cancellationConfirmed ? "cancelled" : "uncertain",
            reason:
              "Local execution ended. A cancellation dispatch alone does not confirm remote stop; explicitly continue only after checking the original chat.",
          },
        });
      }
    } finally {
      terminal = true;
      if (client) await client.shutdown();
      else socket.close();
      await Promise.all(work);
    }
  }
  if (caught) throw caught;
  if (failure)
    throw new CliError(
      safeText(
        `AHP ${stage} stream failed for Agent ${profile.connection.agent}${identity ? ` (session ${identity.sessionUri})` : ""}: ${failure.message}`,
        profile,
      ),
      6,
      "ahp-error",
    );
  signal.throwIfAborted();
  if (!outcome) throw new CliError("AHP invocation ended without a valid outcome.", 6, "ahp-error");
  return outcome;
}
