# Check runtime files

Shared private owner/ACL, no-follow tree verification, immutable snapshot and
file-mutex primitives. Check Host re-exports these APIs for v1 compatibility.
This layer has no scheduler, download, or Objective dependencies.
Native mutex guards remain strongly owned until confirmed close; an unresolved
callback's Promise becoming garbage-collectable must not release a live owner's lock.

`readConfinedFile` supplies bounded regular-file reads beneath explicitly allowed
native directory roots. Windows uses per-operation no-reparse native handles
without write/delete sharing and a private owned compiler scratch directory;
POSIX uses pinned descriptor-relative opens with no-follow flags. Unsupported
host facilities fail closed. It does not interpret artifact schemas or URLs.
See the exact [file-source boundaries](../../docs/task-server.md#local-file-source-boundaries).

The `/worker` entry is the extracted Node CommonJS worker runner shared by the
legacy Host shim and the generic `check-task` adapter. It is an executable worker
entry, not a module to import on the main thread. `/worker-json` exposes the
unchanged legacy worker finite-JSON guard. Neither adds a scheduler/state machine.

Windows helper startup and native compilation have a bounded 60s budget; after
the readiness handshake, each private-file operation retains its 15s deadline.
POSIX reads retry a descriptor unlinked by concurrent atomic replacement, then
revalidate the reopened file. Owner, mode, no-follow and hard-link checks remain
mandatory; insecure metadata is never retried as a successful read.
