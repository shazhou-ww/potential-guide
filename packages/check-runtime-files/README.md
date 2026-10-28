# Check runtime files

Shared private owner/ACL, no-follow tree verification, immutable snapshot and
file-mutex primitives. Check Host re-exports these APIs for v1 compatibility.
This layer has no scheduler, download, or Objective dependencies.

Windows helper startup and native compilation have a bounded 60s budget; after
the readiness handshake, each private-file operation retains its 15s deadline.
POSIX reads retry a descriptor unlinked by concurrent atomic replacement, then
revalidate the reopened file. Owner, mode, no-follow and hard-link checks remain
mandatory; insecure metadata is never retried as a successful read.
