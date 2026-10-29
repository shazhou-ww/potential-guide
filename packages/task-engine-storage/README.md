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

See [the engine guide](../../docs/task-engine.md).
