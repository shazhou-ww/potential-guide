// Generated from objective-pilot/src/evidence.ts. Do not edit.
import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, constants, lstatSync, mkdirSync, openSync, writeFileSync, } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
export function reportArguments(argv) {
    const args = [];
    let enabled = true;
    let directory;
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === "--no-reports")
            enabled = false;
        else if (arg === "--report-dir") {
            const value = argv[++index];
            if (value === undefined || value.trim() === "" || value.startsWith("--"))
                throw new Error("--report-dir requires a directory.");
            directory = resolve(value);
        }
        else if (arg !== undefined)
            args.push(arg);
    }
    return { args, options: { enabled, ...(directory === undefined ? {} : { directory }) } };
}
const LIMIT = 1024 * 1024;
const SECRET = /password|passwd|secret|token|authorization|credential|private.?key|api.?key/i;
function safeValue(value, key = "", depth = 0, secrets = new Set()) {
    if (SECRET.test(key))
        return "[REDACTED]";
    if (depth > 20)
        return "[TRUNCATED]";
    if (typeof value === "string") {
        let text = value;
        for (const secret of secrets)
            text = text.replaceAll(secret, "[REDACTED]");
        return text.length > 8192 ? `${text.slice(0, 8192)}[TRUNCATED]` : text;
    }
    if (Array.isArray(value))
        return value.map((entry) => safeValue(entry, "", depth + 1, secrets));
    if (value !== null && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([name, entry]) => [
            name,
            safeValue(entry, name, depth + 1, secrets),
        ]));
    return value;
}
export function defaultReportDirectory() {
    const state = process.env.PGUIDE_STATE_DIRECTORY ??
        (process.platform === "win32"
            ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "pguide")
            : join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "pguide"));
    return resolve(state, "reports");
}
export class EvidenceStream {
    context;
    directory;
    secrets = new Set();
    seq = 0;
    bytes = 0;
    truncated = false;
    path;
    constructor(context, directory, filename = "events.jsonl") {
        this.context = context;
        this.directory = directory;
        this.path = join(directory, filename);
        writeFileSync(this.path, "", { flag: "wx", mode: 0o600 });
    }
    emit(event, data) {
        if (this.truncated)
            return;
        const body = JSON.stringify({
            schemaVersion: 1,
            time: new Date().toISOString(),
            seq: ++this.seq,
            ...this.context,
            event,
            data: safeValue(data, "", 0, this.secrets),
        });
        if (this.bytes + Buffer.byteLength(body) > LIMIT) {
            this.truncated = true;
            appendFileSync(this.path, `${JSON.stringify({ schemaVersion: 1, time: new Date().toISOString(), seq: this.seq, ...this.context, event: "evidence.truncated", data: { limitBytes: LIMIT } })}\n`);
            process.stderr.write(`pguide evidence truncated: ${this.path}\n`);
            return;
        }
        try {
            appendFileSync(this.path, `${body}\n`);
        }
        catch (error) {
            process.stderr.write(`pguide evidence write failed: ${this.path}\n`);
            throw error;
        }
        this.bytes += Buffer.byteLength(body) + 1;
    }
    protect(value, sensitive = false) {
        if (typeof value === "string" && sensitive && value !== "")
            this.secrets.add(value);
        else if (value !== null && typeof value === "object")
            for (const [key, entry] of Object.entries(value))
                this.protect(entry, sensitive || SECRET.test(key));
    }
}
export class RunEvidence {
    runId = randomUUID();
    directory;
    stream;
    attempts = new Map();
    constructor(options = {}) {
        this.directory = resolve(options.directory ?? defaultReportDirectory(), this.runId);
        mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        this.stream = new EvidenceStream({ runId: this.runId }, this.directory);
        this.stream.emit("run.started", { node: process.version, platform: process.platform });
    }
    startCheck(identity) {
        const key = JSON.stringify(identity);
        const attempt = (this.attempts.get(key) ?? 0) + 1;
        this.attempts.set(key, attempt);
        const checkRunId = randomUUID();
        const directory = join(this.directory, "checks", checkRunId);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const context = { runId: this.runId, checkRunId, attempt, directory };
        this.stream.emit("check.started", { ...context, directory: `checks/${checkRunId}`, identity });
        return context;
    }
    finishCheck(context, envelope) {
        const result = JSON.stringify(safeValue(envelope, "", 0, this.stream.secrets));
        const truncated = Buffer.byteLength(result) > LIMIT;
        writeFileSync(join(context.directory, "result.json"), `${truncated ? JSON.stringify({ truncated: true, limitBytes: LIMIT }) : result}\n`, {
            flag: "wx",
            mode: 0o600,
        });
        this.stream.emit("check.finished", {
            checkRunId: context.checkRunId,
            attempt: context.attempt,
            result: `checks/${context.checkRunId}/result.json`,
            resultPolicy: "redacted-bounded",
            truncated,
            envelope,
        });
    }
}
function inheritedContext() {
    const source = process.env.PGUIDE_EVIDENCE_CONTEXT;
    if (source === undefined)
        return undefined;
    const value = JSON.parse(source);
    if (value === null ||
        typeof value !== "object" ||
        !("directory" in value) ||
        typeof value.directory !== "string" ||
        !isAbsolute(value.directory) ||
        !("runId" in value) ||
        typeof value.runId !== "string" ||
        !("checkRunId" in value) ||
        typeof value.checkRunId !== "string" ||
        !("attempt" in value) ||
        !Number.isSafeInteger(value.attempt) ||
        Number(value.attempt) < 1)
        throw new Error("Invalid PGUIDE_EVIDENCE_CONTEXT.");
    return {
        directory: value.directory,
        runId: value.runId,
        checkRunId: value.checkRunId,
        attempt: Number(value.attempt),
    };
}
export class CheckEvidence {
    context;
    stream;
    constructor(context) {
        this.context = context;
        if (lstatSync(context.directory).isSymbolicLink() ||
            !lstatSync(context.directory).isDirectory())
            throw new Error("Check evidence directory must be a real directory.");
        this.stream = new EvidenceStream({ runId: context.runId, checkRunId: context.checkRunId, attempt: context.attempt }, context.directory);
    }
    fact(event, data) {
        this.stream.emit(event, data);
    }
    artifact(path, content) {
        const parts = path.split(/[\\/]/);
        if (isAbsolute(path) ||
            parts.some((part) => !part || part === "." || part === ".." || part.includes(":")))
            throw new Error("Artifact path must stay inside the check directory.");
        const root = join(this.context.directory, "artifacts");
        try {
            mkdirSync(root, { mode: 0o700 });
        }
        catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST")
                throw error;
        }
        if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory())
            throw new Error("Artifact root must be a real directory.");
        let parent = root;
        for (const part of parts.slice(0, -1)) {
            parent = join(parent, part);
            try {
                mkdirSync(parent, { mode: 0o700 });
            }
            catch (error) {
                if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST")
                    throw error;
            }
            if (!lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink())
                throw new Error("Artifact directories must not be symbolic links.");
        }
        const destination = join(root, ...parts);
        const rel = relative(this.context.directory, destination);
        if (rel.startsWith(`..${sep}`) || isAbsolute(rel))
            throw new Error("Artifact path escaped the check directory.");
        if (Buffer.byteLength(content) > LIMIT) {
            this.fact("artifact.truncated", { path, limitBytes: LIMIT });
            throw new Error("Artifact exceeds 1 MiB.");
        }
        const fd = openSync(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
        try {
            writeFileSync(fd, content);
        }
        finally {
            closeSync(fd);
        }
        this.fact("artifact.created", {
            path: rel.split(sep).join("/"),
            bytes: Buffer.byteLength(content),
        });
    }
}
export async function withCheckEvidence(identity, invoke, options = {}) {
    if (options.enabled === false || process.env.PGUIDE_EVIDENCE_DISABLED === "1")
        return invoke(undefined);
    const inherited = inheritedContext();
    const run = inherited === undefined ? new RunEvidence(options) : undefined;
    const context = inherited ?? run?.startCheck(identity);
    if (context === undefined)
        throw new Error("Missing check evidence context.");
    const evidence = new CheckEvidence(context);
    evidence.fact("business.started", { identity });
    try {
        const value = await invoke(evidence);
        evidence.fact("business.finished", { result: value });
        for (const secret of evidence.stream.secrets)
            run?.stream.secrets.add(secret);
        run?.finishCheck(context, value);
        run?.stream.emit("run.finished", { outcome: "completed" });
        return value;
    }
    catch (error) {
        evidence.fact("business.failed", { error: error instanceof Error ? error.name : "unknown" });
        run?.stream.emit("run.failed", { outcome: "execution-error" });
        throw error;
    }
}
