import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stopTree } from "./src/execution.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const limit = 262144;
const fixtures = [
  "gitignore",
  "objective.yaml",
  "checks/marker/worker.cjs",
  "references/checks/marker/en-US.md",
  "references/levels/terminal/en-US.md",
  "references/levels/repaired/en-US.md",
  "references/problems/marker-incorrect/en-US.md",
  "references/system/404/en-US.md",
  "references/system/overview/en-US.md",
];

class TargetFault extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "TargetFault";
    this.status = status;
  }
}

export function validateTarget(target) {
  if (
    target?.type !== "ssh" ||
    target.shell !== "posix" ||
    Object.keys(target).some((key) => !["type", "host", "shell", "node", "port"].includes(key)) ||
    typeof target.host !== "string" ||
    !/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(target.host) ||
    (target.node !== undefined &&
      (typeof target.node !== "string" ||
        !/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*|\/[A-Za-z0-9_./-]+)$/.test(target.node))) ||
    (target.port !== undefined &&
      (!Number.isSafeInteger(target.port) || target.port < 1 || target.port > 65535))
  )
    throw new TargetFault(
      "invalid-target: SSH requires a safe alias/user@host, shell:posix, optional executable node path and port.",
      400,
    );
}

// Runs entirely on B. No files, HOME values, configuration, or credentials from A are copied.
export const remoteBootstrap = `
const {mkdir,mkdtemp,writeFile,rm}=require("node:fs/promises");
const {dirname,join}=require("node:path");
const {pathToFileURL}=require("node:url");
const {hostname,userInfo}=require("node:os");
let directory;
const controller=new AbortController();
process.on("SIGHUP",()=>controller.abort());
process.on("SIGTERM",()=>controller.abort());
process.stdout.on("error",()=>{});
(async()=>{
  const [major,minor]=process.versions.node.split(".").map(Number);
  if(major<22||(major===22&&minor<13))throw Error("unsupported-node");
  let input="";let bytes=0;
  const timer=setTimeout(()=>process.stdin.destroy(Error("input-timeout")),5000);
  try {
    for await(const chunk of process.stdin){
      bytes+=chunk.length;if(bytes>262144)throw Error("input-limit");input+=chunk;
    }
  } finally {clearTimeout(timer);}
  const payload=JSON.parse(input);
  await mkdir(payload.subject.scratchDirectory,{recursive:true});
  directory=await mkdtemp(join(payload.subject.scratchDirectory,"pguide-setup-transport-"));
  for(const [name,source] of Object.entries(payload.files)){
    if(name.includes("..")||name.startsWith("/")||name.includes("\\\\"))throw Error("invalid-file");
    const path=join(directory,name);await mkdir(dirname(path),{recursive:true});
    await writeFile(path,source,{mode:0o600});
  }
  const {check}=await import(pathToFileURL(join(directory,"setup-check.mjs")).href);
  const result=await check(payload.stage,payload.subject,{signal:controller.signal});
  const identity={hostname:hostname(),user:userInfo().username};
  await rm(directory,{recursive:true,force:true,maxRetries:3});directory=undefined;
  process.stdout.write(JSON.stringify({result,identity}));
})().catch(async()=>{
  if(directory)await rm(directory,{recursive:true,force:true,maxRetries:3}).catch(()=>{});
  process.exitCode=70;
});
`;

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

export async function sshRequest(stage, subject) {
  validateTarget(subject.target);
  const { target, userHome: _userHome, ...remoteSubject } = subject;
  const files = {
    "setup-check.mjs": 'export {check} from "./src/setup-runtime.mjs";\n',
    "src/setup-runtime.mjs": await readFile(join(here, "runtime", "setup-check.mjs"), "utf8"),
  };
  for (const name of fixtures)
    files[`sanity-fixture/${name}`] = await readFile(join(here, "sanity-fixture", name), "utf8");
  const input = JSON.stringify({ stage, subject: remoteSubject, files });
  if (Buffer.byteLength(input) > limit)
    throw new TargetFault("remote-payload-limit: helper payload exceeded 256 KiB.", 400);
  const node = quote(target.node ?? "node");
  // Exit 69 is reserved for an absent target Node, 70 for target helper/bootstrap failure.
  const command = `command -v ${node} >/dev/null 2>&1 || exit 69; exec ${node} -e ${quote(remoteBootstrap)}`;
  const args = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "KbdInteractiveAuthentication=no",
    "-o",
    "ForwardAgent=no",
    "-o",
    "ForwardX11=no",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "PermitLocalCommand=no",
    "-o",
    "ControlMaster=no",
    "-o",
    "ControlPath=none",
    "-o",
    "SendEnv=-*",
    "-o",
    "SetEnv=PGUIDE_SETUP_REMOTE=1",
    "-o",
    "ConnectTimeout=5",
    "-o",
    "ConnectionAttempts=1",
    "-o",
    "ServerAliveInterval=5",
    "-o",
    "ServerAliveCountMax=1",
    ...(target.port === undefined ? [] : ["-p", String(target.port)]),
    "--",
    target.host,
    command,
  ];
  return { command: "ssh", args, input, timeoutMs: (subject.timeoutMs ?? 20000) + 10000 };
}

// The runner is separated for fixture tests; subjects cannot inject a transport or executable.
export async function runSsh(request) {
  return new Promise((done, reject) => {
    const child = spawn(request.command, request.args, {
      windowsHide: true,
      detached: process.platform !== "win32",
      env: request.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let bytes = 0;
    let failure;
    let stopping;
    const stop = (error) => {
      failure ??= error;
      stopping ??= stopTree(child).catch(() => {
        child.kill("SIGKILL");
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        failure = new TargetFault("ssh-cleanup-failed: owned transport process cleanup failed.");
      });
    };
    const timer = setTimeout(
      () =>
        stop(
          new TargetFault(
            "ssh-timeout: target deadline exceeded; remote cleanup has its own bounded deadline.",
            504,
          ),
        ),
      request.timeoutMs,
    );
    child.once("error", () => {
      failure = new TargetFault("ssh-unavailable: install an SSH client on the control machine.");
    });
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) stop(new TargetFault("ssh-output-limit: target output exceeded 256 KiB."));
      else stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) stop(new TargetFault("ssh-output-limit: target output exceeded 256 KiB."));
    });
    // A refused connection closes stdin; the SSH exit code remains the useful classification.
    child.stdin.on("error", () => {});
    child.once("close", async (code) => {
      clearTimeout(timer);
      if (stopping) await stopping;
      if (failure) reject(failure);
      else done({ code, stdout });
    });
    child.stdin.end(request.input);
  });
}

export async function checkSsh(stage, subject, execute = runSsh) {
  const result = await execute(await sshRequest(stage, subject));
  if (result.code === 255)
    throw new TargetFault(
      "ssh-unreachable: target connection/authentication/trust failed; verify existing host trust and noninteractive authorization on A. No local fallback.",
    );
  if (result.code === 69)
    throw new TargetFault(
      "remote-node-missing: install Node.js >=22.13 on B with the control Agent before retrying, or supply target.node.",
    );
  if (result.code !== 0)
    throw new TargetFault(
      "remote-helper-failed: check POSIX shell, target Node, scratch permissions and cleanup prerequisites on B.",
    );
  let remote;
  try {
    remote = JSON.parse(result.stdout);
  } catch {
    throw new TargetFault("remote-helper-protocol: expected one bounded target JSON response.");
  }
  const envelope = remote?.result;
  const identityText = (value) =>
    typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\r\n\0]/.test(value);
  if (
    !identityText(remote?.identity?.hostname) ||
    !identityText(remote?.identity?.user) ||
    ![200, 400, 408, 502, 504].includes(envelope?.status) ||
    typeof envelope.message !== "string" ||
    (envelope.status === 200
      ? typeof envelope.payload?.ok !== "boolean" || !Array.isArray(envelope.payload.problems)
      : envelope.payload !== null)
  )
    throw new TargetFault("remote-helper-protocol: invalid target identity or check envelope.");
  // Evidence is informational; an alias is a connection destination, not a hostname assertion.
  return {
    status: envelope.status,
    payload: envelope.payload,
    message: JSON.stringify({
      target: {
        type: "ssh",
        connection: subject.target.host,
        hostname: remote.identity.hostname,
        user: remote.identity.user,
      },
      diagnostic: envelope.message,
    }),
  };
}
