import assert from "node:assert/strict";
import { openSqliteStore } from "@potential-guide/task-engine-storage";
import { harness } from "./support.mjs";

const [filename, expectedCode] = process.argv.slice(2);
const store = openSqliteStore(filename);
let actual;
try {
  const h = harness({ store, omitOriginal: expectedCode === "unsupported_version", currentVersion: "2" });
  await h.close();
  throw Error("预期启动失败，但探测引擎成功启动");
} catch (error) {
  actual = error.code;
  assert.equal(actual, expectedCode);
} finally { store.close(); }
process.send?.({ expectedCode, actual, closed: true });
