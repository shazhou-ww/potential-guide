import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export function parseCollection(reply) {
  const path = /\bobject path "(\/[a-z0-9_/]*)"/i.exec(reply)?.[1];
  if (path === "/") return undefined;
  if (!path || !/^\/org\/freedesktop\/secrets\/collection\/[a-z0-9_]+$/i.test(path))
    throw new Error("Unexpected Secret Service collection response.");
  return path;
}

export function parseLocked(reply) {
  const value = /\bvariant\s+boolean (true|false)\b/.exec(reply)?.[1];
  if (value === undefined) throw new Error("Unexpected Secret Service lock response.");
  return value === "true";
}

const execute = (command, args, input) =>
  execFileSync(command, args, {
    encoding: "utf8",
    timeout: 10000,
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
const call = (path, method, ...args) =>
  execute("dbus-send", [
    "--session",
    "--print-reply",
    "--reply-timeout=5000",
    "--dest=org.freedesktop.secrets",
    path,
    method,
    ...args,
  ]);

export function keychainState() {
  const names = execute("dbus-send", [
    "--session",
    "--print-reply",
    "--reply-timeout=5000",
    "--dest=org.freedesktop.DBus",
    "/org/freedesktop/DBus",
    "org.freedesktop.DBus.ListNames",
  ]);
  if (!names.includes('"org.freedesktop.secrets"'))
    return { serviceAvailable: false, collectionExists: false, locked: true };
  const collection = parseCollection(
    call("/org/freedesktop/secrets", "org.freedesktop.Secret.Service.ReadAlias", "string:default"),
  );
  return {
    serviceAvailable: true,
    collection,
    collectionExists: collection !== undefined,
    locked:
      collection === undefined ||
      parseLocked(
        call(
          collection,
          "org.freedesktop.DBus.Properties.Get",
          "string:org.freedesktop.Secret.Collection",
          "string:Locked",
        ),
      ),
  };
}

async function unlockedState() {
  const deadline = Date.now() + 5000;
  do {
    const state = keychainState();
    if (!state.locked) return state;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error("Keychain did not unlock.");
}

async function selfTest() {
  let stage = "fresh-container";
  try {
    assert.equal(process.env.PGUIDE_KEYCHAIN_SELF_TEST, "1");
    assert.equal(keychainState().collectionExists, false, "Only use a fresh disposable container.");
    const password = randomBytes(32).toString("hex");
    const value = randomBytes(32).toString("hex");
    const id = randomBytes(16).toString("hex");
    const unlock = (input = password) =>
      execute(
        "gnome-keyring-daemon",
        [
          "--replace",
          "--unlock",
          "--components=secrets",
          `--control-directory=${process.env.XDG_RUNTIME_DIR}/keyring`,
        ],
        input,
      );
    stage = "initialize";
    unlock();
    const state = await unlockedState();
    assert.equal(state.locked, false);
    stage = "store";
    execute(
      "secret-tool",
      ["store", "--label=pguide disposable keychain test", "pguide-test", id],
      value,
    );
    stage = "lookup";
    assert.equal(execute("secret-tool", ["lookup", "pguide-test", id]).trimEnd(), value);
    stage = "encrypted-file";
    const file = join(process.env.HOME, ".local", "share", "keyrings", "login.keyring");
    const encrypted = await readFile(file);
    assert.equal(encrypted.subarray(0, "GnomeKeyring".length).toString(), "GnomeKeyring");
    assert.equal(encrypted.includes(Buffer.from(value)), false);
    assert.equal(encrypted.includes(Buffer.from(password)), false);
    assert.equal((await lstat(file)).mode & 0o077, 0);
    stage = "lock";
    call(
      "/org/freedesktop/secrets",
      "org.freedesktop.Secret.Service.Lock",
      `array:objpath:${state.collection}`,
    );
    assert.equal(keychainState().locked, true);
    stage = "wrong-password";
    unlock(randomBytes(32).toString("hex"));
    await assert.rejects(unlockedState(), /Keychain did not unlock/);
    stage = "unlock";
    unlock();
    assert.equal((await unlockedState()).locked, false);
    assert.equal(execute("secret-tool", ["lookup", "pguide-test", id]).trimEnd(), value);
    stage = "clear";
    execute("secret-tool", ["clear", "pguide-test", id]);
    return {
      status: "verified",
      roundTrip: true,
      encryptedFile: true,
      lockAndUnlock: true,
      wrongPasswordRejected: true,
    };
  } catch {
    throw new Error(`Self-test stage: ${stage}`);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    assert.notEqual(process.getuid?.(), 0);
    const { values } = parseArgs({
      options: {
        "self-test": { type: "boolean", default: false },
        "require-unlocked": { type: "boolean", default: false },
      },
    });
    const report = values["self-test"]
      ? await selfTest()
      : values["require-unlocked"]
        ? await unlockedState()
        : keychainState();
    console.log(JSON.stringify(report, null, 2));
    if (values["require-unlocked"] && report.locked) process.exitCode = 1;
  } catch (error) {
    const stage = /^Self-test stage: ([a-z-]+)$/.exec(error.message)?.[1];
    console.error(
      `Keychain check failed${stage ? ` at ${stage}` : ""}; no credential or password was printed.`,
    );
    process.exitCode = 1;
  }
}
