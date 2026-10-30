import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { syncBuiltinESMExports } from "node:module";
import fs, {
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
  rename,
  symlink,
  open,
  link,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { mock } from "node:test";
import { readConfinedFile, ConfinedFileError, filePathAllowed } from "../src/confined-file.js";

async function fixture() {
  const root = resolve(".cache", `confined-${randomUUID()}`);
  const imports = join(root, "imports");
  await mkdir(imports, { recursive: true });
  const path = join(imports, "archive");
  await writeFile(path, "inside");
  const signal = new AbortController().signal;
  return {
    root,
    imports,
    path,
    signal,
    read: (file = path, maximum = 100) => readConfinedFile(file, [imports], maximum, signal),
    close: () => rm(root, { recursive: true, force: true }),
  };
}
test("confined ordinary file reader is binary, bounded and denies sibling-prefix roots", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.read()).toString(), "inside");
    if (process.platform === "win32") {
      assert.equal(filePathAllowed(f.path, [f.imports.toUpperCase()]), false);
      await assert.rejects(readConfinedFile(f.path, [f.imports.toUpperCase()], 100, f.signal), {
        code: "file_denied",
      });
      await assert.rejects(f.read(`${f.path}\\`), { code: "file_not_regular" });
    }
    const unicode = join(f.imports, "文 #.tgz");
    await writeFile(unicode, Buffer.from([0, 1, 255]));
    assert.deepEqual(await f.read(unicode), Buffer.from([0, 1, 255]));
    await assert.rejects(f.read(f.path, 2), { code: "file_too_large" });
    await assert.rejects(f.read(join(f.imports, "missing")), { code: "file_missing" });
    await mkdir(`${f.imports}-other`);
    const outside = join(`${f.imports}-other`, "archive");
    await writeFile(outside, "outside");
    await assert.rejects(f.read(outside), { code: "file_denied" });
    await assert.rejects(readConfinedFile(f.path, [f.path], 100, f.signal), {
      code: "file_denied",
    });
    const directory = join(f.imports, "directory");
    await mkdir(directory);
    await assert.rejects(f.read(directory), { code: "file_not_regular" });
    const hard = join(f.imports, "hard");
    await link(f.path, hard);
    await assert.rejects(f.read(hard), { code: "file_not_regular" });
  } finally {
    await f.close();
  }
});
test("final symlinks are refused rather than followed", async (t) => {
  const f = await fixture();
  try {
    const alias = join(f.imports, "alias");
    try {
      await symlink(f.path, alias, "file");
    } catch (error) {
      if (
        process.platform === "win32" &&
        ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")
      ) {
        t.skip("Windows file symlink creation requires permission; junction coverage is separate.");
        return;
      }
      throw error;
    }
    await assert.rejects(f.read(alias), { code: "file_denied" });
  } finally {
    await f.close();
  }
});
test("concurrent directory/junction replacement never returns outside-root bytes", async () => {
  const f = await fixture();
  const victim = join(f.imports, "victim");
  const parked = join(f.imports, "parked");
  const outside = join(f.root, "outside");
  await mkdir(victim);
  await mkdir(outside);
  await writeFile(join(victim, "archive"), "inside");
  await writeFile(join(outside, "archive"), "outside");
  let stopping = false,
    cycles = 0;
  const retryMutation = async (operation: () => Promise<void>) => {
    for (let attempt = 0; ; attempt++) {
      try {
        await operation();
        return;
      } catch (error) {
        if (
          attempt >= 100 ||
          !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")
        )
          throw error;
        await new Promise((done) => setTimeout(done, 2));
      }
    }
  };
  const race = (async () => {
    while (!stopping) {
      try {
        await rename(victim, parked);
      } catch (error) {
        if (!["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? ""))
          throw error;
        await new Promise((done) => setTimeout(done, 1));
        continue;
      }
      try {
        await symlink(outside, victim, process.platform === "win32" ? "junction" : "dir");
        cycles++;
        await new Promise((done) => setTimeout(done, 2));
        await retryMutation(() => rm(victim));
      } finally {
        await retryMutation(() => rename(parked, victim));
      }
    }
  })();
  try {
    for (let count = 0; count < 4; count++) {
      try {
        assert.equal((await f.read(join(victim, "archive"))).toString(), "inside");
      } catch (error) {
        assert.ok(error instanceof ConfinedFileError);
        assert.ok(
          ["file_denied", "file_missing", "file_changed", "file_busy"].includes(error.code),
          error.code,
        );
      }
    }
  } finally {
    stopping = true;
    await race;
    assert.ok(cycles > 0);
    assert.equal((await f.read(join(victim, "archive"))).toString(), "inside");
    assert.equal(await readFile(join(outside, "archive"), "utf8"), "outside");
    await f.close();
  }
});
test("Windows native file guard refuses a concurrent writable handle", {
  skip: process.platform !== "win32",
}, async () => {
  const f = await fixture();
  const writer = await open(f.path, "r+");
  try {
    await assert.rejects(f.read(), { code: "file_busy" });
  } finally {
    await writer.close();
    await f.close();
  }
});
test("POSIX pinned descriptor rejects name replacement after opening the final file", {
  skip: process.platform === "win32",
}, async () => {
  const f = await fixture();
  const original = fs.open;
  let replaced = false;
  mock.method(fs, "open", async (...args: Parameters<typeof open>) => {
    const handle = await original(...args);
    if (!replaced && String(args[0]).endsWith("/archive")) {
      replaced = true;
      await rename(f.path, join(f.imports, "original"));
      await writeFile(f.path, "replacement");
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.read(), { code: "file_changed" });
    assert.equal(replaced, true);
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    await f.close();
  }
});
test("Windows case-sensitive directories cannot bypass root identity with different casing", {
  skip: process.platform !== "win32",
}, async (t) => {
  const f = await fixture();
  const parent = join(f.root, "case");
  await mkdir(parent);
  try {
    try {
      await promisify(execFile)(
        join(process.env.SystemRoot ?? "C:\\Windows", "System32", "fsutil.exe"),
        ["file", "setCaseSensitiveInfo", parent, "enable"],
        { windowsHide: true, timeout: 5000 },
      );
    } catch (error) {
      t.skip(
        `Native per-directory case sensitivity unavailable: ${(error as NodeJS.ErrnoException).code}`,
      );
      return;
    }
    const granted = join(parent, "Allowed");
    const other = join(parent, "allowed");
    await mkdir(granted);
    try {
      await mkdir(other);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        t.skip("Host filesystem/API cannot create distinct case-only directories after enable.");
        return;
      }
      throw error;
    }
    await writeFile(join(granted, "archive"), "inside");
    await writeFile(join(other, "archive"), "outside");
    assert.equal(
      (await readConfinedFile(join(granted, "archive"), [granted], 100, f.signal)).toString(),
      "inside",
    );
    await assert.rejects(readConfinedFile(join(other, "archive"), [granted], 100, f.signal), {
      code: "file_denied",
    });
  } finally {
    await f.close();
  }
});
test("aborted file reads release native helpers and their owned compilation directories", async () => {
  const f = await fixture();
  const controller = new AbortController();
  const reason = new Error("stop-file-read");
  const timer = setTimeout(() => controller.abort(reason), 20);
  try {
    if (process.platform !== "win32") controller.abort(reason);
    const operation = readConfinedFile(f.path, [f.imports], 100, controller.signal);
    await assert.rejects(operation, /stop-file-read/);
    const leftovers = (await readdir(resolve(".cache"))).filter((path) =>
      path.startsWith("check-archive-"),
    );
    assert.deepEqual(leftovers, []);
  } finally {
    clearTimeout(timer);
    await f.close();
  }
});
