import assert from "node:assert/strict";
import test from "node:test";
import { assertDirectoryPreserved, type DirectoryView } from "../fixture/directory-invariants.js";

const baseline: DirectoryView = {
  width: 1383,
  scroll: 100,
  members: [
    { id: "one", key: "task:binding:one" },
    { id: "two", key: "task:binding:two" },
  ],
  drafts: [
    { id: "history-type", value: "unapplied", checked: false },
    { id: "created-from", value: "", checked: false },
    { id: "created-before", value: "", checked: false },
    { id: "only-favorites", value: "on", checked: false },
  ],
  queryReads: ["/tasks?sort=created-desc", "/tasks?sort=created-desc&cursor=next"],
  text: "完整快照 · 未取消 · 时间 eligible · 水位 domain:10",
};

test("drawer invariants allow source status, revision and time text to change", () => {
  assertDirectoryPreserved(baseline, {
    ...structuredClone(baseline),
    text: "完整实时集合 · 已取消 · 时间 timeout · 水位 domain:11",
  });
});

test("drawer invariants reject changed queries, members/order, drafts, scroll and width", () => {
  const mutations: ((value: DirectoryView) => void)[] = [
    (value) => value.queryReads.push("/tasks?type=unapplied"),
    (value) => value.queryReads.splice(1, 1),
    (value) => value.members.reverse(),
    (value) => value.members.pop(),
    (value) => {
      value.members[0]!.id = "replacement";
    },
    (value) => {
      value.members[0]!.key = "replacement";
    },
    (value) => {
      value.drafts[0]!.value = "";
    },
    (value) => {
      value.drafts[3]!.checked = true;
    },
    (value) => {
      value.scroll = 0;
    },
    (value) => {
      value.width = 753;
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(baseline);
    mutate(changed);
    assert.throws(() => assertDirectoryPreserved(baseline, changed));
  }
});
