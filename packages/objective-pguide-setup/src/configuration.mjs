import { lstat } from "node:fs/promises";
import { Fault, nonempty, Problem, record } from "./contract.mjs";
import { installation, jsonOutput } from "./installation.mjs";
export async function configured(subject, context) {
  await installation(subject, context);
  try {
    if (!(await lstat(subject.configPath)).isFile()) throw new Problem("configuration-invalid");
  } catch (error) {
    if (error.code === "ENOENT") throw new Problem("configuration-missing");
    throw error;
  }
  const help = await context.cli(["--help"], subject.configPath, subject.workingDirectory);
  if (help.code !== 0) throw new Problem("configuration-invalid");
  const capabilities = jsonOutput(help);
  if (!Array.isArray(capabilities.commands) || !record(capabilities.conflicts))
    throw new Fault("protocol: unsupported command discovery response.");
  for (const name of ["config", "agents", "probe", "regulate"])
    if (
      capabilities.conflicts[name] !== undefined ||
      !capabilities.commands.some(
        (entry) =>
          entry.command === name &&
          entry.compatible === true &&
          entry.protocol === "pguide-command-v1",
      )
    )
      throw new Problem("command-unavailable");
  const result = await context.cli(
    ["config", "show"],
    subject.configPath,
    subject.workingDirectory,
  );
  if (result.code !== 0) throw new Problem("configuration-invalid");
  const value = jsonOutput(result);
  if (value.schemaVersion !== 1 || !record(value.config) || value.config.schemaVersion !== 2)
    throw new Fault("protocol: unsupported configuration response.");
  const config = value.config;
  const name = subject.agent ?? config.defaultAgent;
  if (!nonempty(name)) throw new Problem("agent-missing");
  const selected = await context.cli(
    ["agents", "show", name],
    subject.configPath,
    subject.workingDirectory,
  );
  if (selected.code !== 0) throw new Problem("agent-missing");
  const resource = jsonOutput(selected);
  if (!record(resource.profile)) throw new Fault("protocol: unsupported Agent resource response.");
  const profile = resource.profile;
  if (profile.type === "ahp")
    throw new Problem("acp-unavailable", {
      reason:
        "This setup Pilot verifies ACP stdio readiness only. Select an ACP profile; AHP runtime support does not imply ACP compatibility.",
    });
  if (
    !(
      (profile.type === "acp" && profile.connection?.type === undefined) ||
      (profile.type === undefined && profile.connection?.type === "acp")
    ) ||
    !/^[1-9][0-9]*$/.test(profile.connection.protocolVersion) ||
    typeof profile.connection.protocolVersion !== "string" ||
    !Number.isSafeInteger(Number(profile.connection.protocolVersion)) ||
    profile.transport?.type !== "stdio" ||
    !nonempty(profile.transport.command) ||
    (profile.transport.args !== undefined &&
      (!Array.isArray(profile.transport.args) || !profile.transport.args.every(nonempty))) ||
    (profile.transport.env !== undefined &&
      (!Array.isArray(profile.transport.env) ||
        !profile.transport.env.every((key) => /^[A-Z_][A-Z0-9_]*$/.test(key))))
  )
    throw new Fault("protocol: invalid Agent profile returned by agents.");
  if ((profile.transport.env ?? []).some((key) => !nonempty(context.env[key])))
    throw new Problem("environment-unavailable");
  return { config, name, profile };
}
export async function acpReady(profile, context, directory) {
  const allowed = [
    "PATH",
    ...(process.platform === "win32" ? ["SystemRoot", "ComSpec"] : []),
    ...(profile.transport.env ?? []),
  ];
  const env = Object.fromEntries(
    allowed.flatMap((key) => (context.env[key] === undefined ? [] : [[key, context.env[key]]])),
  );
  let buffer = "";
  let phase = 1;
  let ready = false;
  const send = (child, id, method, params) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  const result = await context.execute(profile.transport.command, profile.transport.args ?? [], {
    env,
    missing: "acp-unavailable",
    begin: (child) =>
      send(child, 1, "initialize", {
        protocolVersion: Number(profile.connection.protocolVersion),
        clientInfo: { name: "pguide-setup", version: "1" },
        clientCapabilities: {},
      }),
    onLine(chunk, child, stop) {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          stop(new Fault("protocol: malformed ACP JSON."));
          return;
        }
        if (!record(message) || message.jsonrpc !== "2.0") {
          stop(new Fault("protocol: invalid ACP response."));
          return;
        }
        if (message.id === undefined && nonempty(message.method)) continue;
        if (message.id !== phase || message.method !== undefined) {
          stop(new Fault("protocol: unexpected ACP response."));
          return;
        }
        if (message.error !== undefined) {
          stop(
            new Problem("acp-unavailable", {
              stage: phase === 1 ? "initialize" : "session-new",
              reason: "agent-rejected",
            }),
          );
          return;
        }
        if (!record(message.result)) {
          stop(new Fault("protocol: ACP result must be an object."));
          return;
        }
        if (phase === 1) {
          if (
            message.result.protocolVersion !== Number(profile.connection.protocolVersion) ||
            (profile.requirements?.sessionResume === true &&
              message.result.agentCapabilities?.loadSession !== true)
          ) {
            stop(
              new Problem("acp-unavailable", {
                stage: "initialize",
                reason: "incompatible-capabilities",
              }),
            );
            return;
          }
          phase = 2;
          send(child, 2, "session/new", { cwd: directory, mcpServers: [] });
        } else {
          if (!nonempty(message.result.sessionId)) {
            stop(new Fault("protocol: ACP session/new returned no sessionId."));
            return;
          }
          ready = true;
          child.stdin.end();
          // Readiness is complete; terminate even Agents that do not exit on EOF.
          stop(undefined);
        }
      }
    },
  });
  if (!ready || (result.code !== 0 && phase !== 2))
    throw new Problem("acp-unavailable", {
      stage: phase === 1 ? "initialize" : "session-new",
      reason: "agent-exited",
    });
}
