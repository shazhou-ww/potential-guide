import assert from "node:assert/strict";

export interface DirectoryView {
  width: number;
  scroll: number;
  members: { id: string; key: string }[];
  drafts: { id: string; value: string; checked: boolean }[];
  queryReads: string[];
  text: string;
}

export function assertDirectoryPreserved(before: DirectoryView, after: DirectoryView): void {
  assert.ok(before.members.length > 0 && before.queryReads.length > 0);
  assert.ok(before.members.every((member) => member.id && member.key));
  assert.equal(new Set(before.members.map((member) => member.id)).size, before.members.length);
  assert.equal(after.width, before.width, "Opening details changed the directory width.");
  assert.equal(after.scroll, before.scroll, "Opening details changed the directory scroll.");
  assert.deepEqual(after.members, before.members, "Opening details changed members or order.");
  assert.deepEqual(after.drafts, before.drafts, "Opening details changed unapplied filter drafts.");
  assert.deepEqual(
    after.queryReads,
    before.queryReads,
    "Opening details reissued a directory query.",
  );
}
