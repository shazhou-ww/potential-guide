# @potential-guide/objective-declarations

Shared tool-side Objective declaration parsing, discovery, context, selection,
input validation and subject binding. Uses CLI infrastructure and Pilot protocol
only: no observation, regulation, source acquisition or command packages.
Declaration mutation belongs to `@potential-guide/pguide-objectives`.

Public APIs include `parseObjectives`, `objectivesPath`, `listObjectives`,
`objectiveContext`, `bindObjective`, `selectObjective` and `readObjectiveEntries`.
See [layering](../../docs/package-layering.md) and
[declaration reference](../pguide/README.md).
