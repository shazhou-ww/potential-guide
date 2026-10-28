import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

test("HTTPS Objective Pilot/regulator uses Host v2 with fixed recovery and References", {
  timeout: 120_000,
}, async () => {
  const parent = resolve(".cache", "host-v2-business");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "case-"));
  const exec = promisify(execFile);
  const openssl =
    process.platform === "win32"
      ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin", "openssl.exe")
      : "openssl";
  const { NODE_TEST_CONTEXT: _context, ...environment } = process.env;
  try {
    await exec(
      openssl,
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-keyout",
        join(directory, "key.pem"),
        "-out",
        join(directory, "cert.pem"),
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { cwd: directory },
    );
    const result = await exec(process.execPath, ["--test", "test/host-v2.case.mjs"], {
      cwd: resolve("."),
      timeout: 110_000,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...environment,
        V2_BUSINESS_DIRECTORY: directory,
        NODE_EXTRA_CA_CERTS: join(directory, "cert.pem"),
        NODE_OPTIONS: "",
      },
    });
    assert.match(result.stdout, /fail 0/);
    console.log(result.stdout.trim());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
