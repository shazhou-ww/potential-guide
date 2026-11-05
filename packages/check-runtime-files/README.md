# Check runtime files

Shared private owner/ACL, no-follow tree verification, immutable snapshot and
file-mutex primitives. The retired Host re-export shims have been removed;
consumers import these APIs directly.
Artifact directories use native recursive `opendir` and bounded file streams.
Relative directory arguments and read-only hard links are supported; symbolic
links and special files are rejected. This read does not require callers to
pre-canonicalize paths or claim atomicity through inode/timestamp comparisons.
Caller budgets remain enforced and execution snapshots retain observed bytes
and their digest. These simpler directory rules do not weaken the separate
private-file, mutex or confined-file guards documented below.
This layer has no scheduler, download, or Objective dependencies.
Native mutex guards remain strongly owned until confirmed close; an unresolved
callback's Promise becoming garbage-collectable must not release a live owner's lock.

`readConfinedFile` supplies bounded regular-file reads beneath explicitly allowed
native directory roots. Windows uses per-operation no-reparse native handles
without write/delete sharing and a private owned compiler scratch directory;
POSIX uses pinned descriptor-relative opens with no-follow flags. Unsupported
host facilities fail closed. It does not interpret artifact schemas or URLs.
See the exact [file-source boundaries](../../docs/task-server.md#local-file-source-boundaries).

The `/worker` entry is the extracted Node CommonJS worker runner used by the
generic `check-task` adapter. It is an executable worker
entry, not a module to import on the main thread. `/worker-json` exposes the
unchanged legacy worker finite-JSON guard. Neither adds a scheduler/state machine.

Windows helper startup and native compilation have a bounded 60s budget; after
the readiness handshake, each private-file operation retains its 15s deadline.
POSIX reads retry a descriptor unlinked by concurrent atomic replacement, then
revalidate the reopened file. Owner, mode, no-follow and hard-link checks remain
mandatory; insecure metadata is never retried as a successful read.
