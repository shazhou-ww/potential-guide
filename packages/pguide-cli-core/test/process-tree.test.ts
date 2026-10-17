import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { killProcessTree } from "@potential-guide/cli-core";

test("forceful cleanup terminates an owned process and its uncooperative child", async () => {
  const childSource = `process.on("SIGTERM",()=>{});console.log(process.pid);setInterval(()=>{},1000);`;
  const rootSource = `
    const {spawn}=require("node:child_process");
    process.on("SIGTERM",()=>{});
    spawn(process.execPath,["-e",${JSON.stringify(childSource)}],{stdio:["ignore","inherit","inherit"]});
    setInterval(()=>{},1000);
  `;
  const child = spawn(process.execPath, ["-e", rootSource], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = once(child, "close");
  try {
    const grandchild = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Child process did not start.")), 5000);
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (output.includes("\n")) {
          clearTimeout(timer);
          resolve(Number(output.trim()));
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    assert.ok(Number.isSafeInteger(grandchild) && grandchild > 0);
    await killProcessTree(child);
    await closed;
    const deadline = Date.now() + 3000;
    while (true) {
      try {
        process.kill(grandchild, 0);
      } catch (error) {
        assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
        break;
      }
      assert.ok(Date.now() < deadline, "Owned descendant remained alive after termination.");
      await delay(10);
    }
  } finally {
    await killProcessTree(child);
    await closed;
  }
});
