# @potential-guide/pguide-objectives

Optional `pguide-objectives` declaration-management command. Standalone use does
not require `pguide`; alongside it, discovery exposes `pguide objectives`.
Read-only listing and showing do not fetch sources or evaluate subjects.
Mutation remains here; shared selection/binding lives in `objective-declarations`, with
no dependency back to this command.

Use `pguide-objectives --help`; see [declaration reference](../pguide/README.md)
and [migration](../../docs/package-layering.md). Existing options, output and
exit codes are preserved.
