# @potential-guide/task-engine-storage

`openSqliteStore(filename)` implements the task-protocol Store using Node's
built-in `node:sqlite` (Node >=22.13; older Node versions may print an experimental
warning). No driver dependency, install script or in-memory fallback.

Uses WAL, foreign keys, synchronous FULL and short atomic event/index/checkpoint
transactions. A separate `.owner` SQLite file holds an OS-released exclusive
lock for exactly one active Engine. Never delete or replace database/owner files
while a host is running. SQLite files must be on a local filesystem.

Open Store, start Engine, close Engine, then close Store. Unknown started work
is interrupted on restart, never automatically rerun. A checkpoint checksum
detects accidental corruption; it is not an authenticity signature.

SQLite `user_version`, checkpoint `projection_version` and Facts
`projectionVersion` are version 2. Existing files are checked read-only before
WAL configuration, initialization or owner locking. Old/unknown formats and
nonempty version-zero databases are rejected with a new-storage instruction.
Choose a new database path; no migration, overwrite, automatic deletion or
memory fallback is performed.
For an existing WAL, inspection uses an operation-owned sibling snapshot because
SQLite read-only WAL connections can still update the original SHM read marks.
The snapshot is removed before return; source changes during copying fail with
`storage_conflict` for retry, never with a silently repaired source database.

See [the engine guide](../../docs/task-engine.md).
