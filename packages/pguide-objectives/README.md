# @potential-guide/pguide-objectives

Optional `pguide-objectives` declaration-management command. Standalone use does
not require `pguide`; alongside it, discovery exposes `pguide objectives`.
Read-only listing and showing do not fetch sources or evaluate subjects.
Mutation remains here; shared selection/binding lives in `objective-declarations`, with
no dependency back to this command.

Use `pguide-objectives --help`; see [declaration reference](../pguide/README.md)
and [migration](../../docs/package-layering.md). Existing options, JSON envelopes and exit codes are preserved.

Default and `--format markdown` output uses headings and labeled summaries:
lists include name, description, scope and source without expanding schemas;
`show <name>` includes input schema, subject and revision. Empty lists explain
the discovery scope and how to add a declaration. Missing names direct you to
`list`; ambiguous names list candidate scopes and files before recommending
`--scope user|directory`. Legacy source aliases remain a separate, labeled
section and are never treated as declarations. Writes identify the action,
name, scope and saved file; migration also identifies the updated legacy file.
