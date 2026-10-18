import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Socket } from "node:net";

export interface RpcMessage {
  id?: number;
  method: string;
  params: Record<string, unknown>;
}

export interface HostConnection {
  send(value: unknown): void;
  raw(text: string): void;
  action(channel: string, action: Record<string, unknown>): void;
  close(): void;
}

export async function ahpHost(
  options: {
    mode?:
      | "complete"
      | "hang"
      | "disconnect"
      | "error"
      | "input"
      | "permission"
      | "result-permission";
    text?: string;
    onTurn?: (prompt: string) => Promise<void>;
    onDenied?: () => Promise<void>;
    permissionInput?: string;
    intercept?: (message: RpcMessage, connection: HostConnection) => boolean;
  } = {},
) {
  const messages: RpcMessage[] = [];
  const sockets = new Set<Socket>();
  let sequence = 0;
  let sessionUri = "";
  let directory = "";
  let provider = "";
  let active: Record<string, unknown> | undefined;
  const turns: Record<string, unknown>[] = [];
  const chatUri = "ahp-chat:/host-default";
  let requestUrl = "";
  const server = createServer();
  server.on("upgrade", (request, socket) => {
    const connectionSocket = socket as Socket;
    sockets.add(connectionSocket);
    socket.on("close", () => sockets.delete(connectionSocket));
    requestUrl = request.url ?? "";
    const key = request.headers["sec-websocket-key"];
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const frame = (payload: Buffer, opcode = 1) => {
      const header = Buffer.alloc(payload.length < 126 ? 2 : payload.length <= 65535 ? 4 : 10);
      header[0] = 0x80 | opcode;
      header[1] = payload.length < 126 ? payload.length : payload.length <= 65535 ? 126 : 127;
      if (payload.length >= 126 && payload.length <= 65535) header.writeUInt16BE(payload.length, 2);
      else if (payload.length > 65535) header.writeBigUInt64BE(BigInt(payload.length), 2);
      socket.write(Buffer.concat([header, payload]));
    };
    const send = (value: unknown) => frame(Buffer.from(JSON.stringify(value)));
    const action = (channel: string, value: Record<string, unknown>) =>
      send({
        jsonrpc: "2.0",
        method: "action",
        params: { channel, action: value, serverSeq: ++sequence },
      });
    const connection: HostConnection = {
      send,
      raw: (text) => frame(Buffer.from(text)),
      action,
      close: () => socket.destroy(),
    };
    const reply = (message: RpcMessage, result: unknown) =>
      send({ jsonrpc: "2.0", id: message.id, result });
    const handle = async (message: RpcMessage) => {
      messages.push(message);
      if (options.intercept?.(message, connection)) return;
      const params = message.params;
      if (message.method === "initialize") {
        reply(message, {
          protocolVersion: "1.0.0",
          serverSeq: sequence,
          snapshots: [
            {
              resource: "ahp-root://",
              fromSeq: sequence,
              state: {
                agents: [
                  {
                    provider: "generic-provider",
                    displayName: "Fixture",
                    description: "",
                    models: [],
                    protectedResources: [{ resource: "https://resource.example.invalid" }],
                  },
                ],
              },
            },
          ],
        });
      } else if (message.method === "resourceResolve")
        reply(message, { uri: params.uri, type: "directory" });
      else if (message.method === "authenticate") reply(message, {});
      else if (message.method === "createSession") {
        sessionUri = String(params.channel);
        provider = String(params.provider);
        directory = String((params.workingDirectories as string[])[0]);
        reply(message, null);
      } else if (message.method === "subscribe") {
        const channel = String(params.channel);
        if (channel !== sessionUri && channel !== chatUri) {
          send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32001, message: "Session not found" },
          });
          return;
        }
        const state =
          channel === sessionUri
            ? {
                lifecycle: "ready",
                provider,
                workingDirectories: [directory],
                title: "",
                status: 1,
                activeClients: [],
                defaultChat: chatUri,
                chats: [
                  { resource: chatUri, title: "", status: 1, modifiedAt: new Date().toISOString() },
                ],
              }
            : {
                resource: chatUri,
                title: "",
                status: 1,
                modifiedAt: new Date().toISOString(),
                turns,
                ...(active ? { activeTurn: active } : {}),
              };
        reply(message, { snapshot: { resource: channel, state, fromSeq: sequence } });
      } else if (message.method === "dispatchAction") {
        const value = params.action as Record<string, unknown>;
        if (value.type === "chat/turnStarted") {
          active = {
            id: value.turnId,
            startedAt: value.startedAt,
            message: value.message,
            responseParts: [],
          };
          action(chatUri, value);
          if (options.mode === "disconnect") {
            socket.destroy();
            return;
          }
          if (options.mode === "hang") return;
          if (options.mode === "input") {
            action(chatUri, {
              type: "chat/inputRequested",
              turnId: value.turnId,
              request: { id: "input", title: "Approval", questions: [] },
            });
            return;
          }
          if (options.mode === "permission" || options.mode === "result-permission") {
            action(chatUri, {
              type: "chat/toolCallStart",
              turnId: value.turnId,
              toolCallId: "tool",
              toolName: "write",
              displayName: "Write",
              invocationMessage: "write",
            });
            action(chatUri, {
              type: "chat/toolCallReady",
              turnId: value.turnId,
              toolCallId: "tool",
              invocationMessage: "write",
              toolInput: options.permissionInput ?? '{"path":"untrusted","kind":"edit"}',
              options: [{ id: "allow", label: "Allow always", kind: "approve" }],
              ...(options.mode === "result-permission" ? { confirmed: "not-needed" } : {}),
            });
            if (options.mode === "result-permission")
              action(chatUri, {
                type: "chat/toolCallComplete",
                turnId: value.turnId,
                toolCallId: "tool",
                result: { success: true, pastTenseMessage: "Result ready" },
                requiresResultConfirmation: true,
              });
            return;
          }
          await options.onTurn?.(String((value.message as { text: string }).text));
          if (options.mode === "error") {
            action(chatUri, {
              type: "chat/error",
              turnId: value.turnId,
              duration: 1,
              part: { kind: "error", error: { errorType: "fixture", message: "Host failure" } },
            });
            turns.push({ ...active, state: "error" });
          } else {
            const part = { kind: "markdown", id: "text", content: options.text ?? "Done" };
            action(chatUri, { type: "chat/responsePart", turnId: value.turnId, part });
            action(chatUri, { type: "chat/turnComplete", turnId: value.turnId, duration: 1 });
            turns.push({ ...active, responseParts: [part], state: "complete" });
          }
          active = undefined;
        } else if (
          value.type === "chat/toolCallConfirmed" ||
          value.type === "chat/toolCallResultConfirmed"
        ) {
          if (value.approved !== false)
            throw new Error("Fixture must never receive automatic approval.");
          action(chatUri, value);
          await options.onDenied?.();
          action(chatUri, { type: "chat/turnComplete", turnId: value.turnId, duration: 1 });
          turns.push({ ...active, state: "complete" });
          active = undefined;
        } else if (value.type === "chat/turnCancelled") {
          action(chatUri, value);
          turns.push({ ...active, state: "cancelled" });
          active = undefined;
        }
      }
    };
    let input = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      input = Buffer.concat([input, chunk]);
      while (input.length >= 2) {
        const opcode = (input[0] as number) & 15;
        let length = (input[1] as number) & 127;
        let offset = 2;
        if (length === 126) {
          if (input.length < 4) return;
          length = input.readUInt16BE(2);
          offset = 4;
        }
        if (length === 127) {
          if (input.length < 10) return;
          length = Number(input.readBigUInt64BE(2));
          offset = 10;
        }
        if (input.length < offset + 4 + length) return;
        const mask = input.subarray(offset, offset + 4);
        const payload = Buffer.from(input.subarray(offset + 4, offset + 4 + length));
        for (let index = 0; index < payload.length; index++)
          payload[index] = (payload[index] as number) ^ (mask[index % 4] as number);
        input = input.subarray(offset + 4 + length);
        if (opcode === 8) {
          frame(Buffer.alloc(0), 8);
          socket.end();
          return;
        }
        if (opcode === 9) {
          frame(payload, 10);
          continue;
        }
        if (opcode === 1)
          void handle(JSON.parse(payload.toString()) as RpcMessage).catch((error: unknown) =>
            socket.destroy(error instanceof Error ? error : new Error("Fixture failed")),
          );
      }
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind.");
  return {
    url: `ws://127.0.0.1:${address.port}`,
    messages,
    get requestUrl() {
      return requestUrl;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
    },
  };
}
