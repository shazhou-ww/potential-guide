# Task authoring integration

Private build integration for this repository's Check and Objective definitions.
Compilation, worker SDKs, protocol validation and CAR processing belong to
[silvermoon-work/task-engine](https://github.com/silvermoon-work/task-engine).
This package only invokes `@silvermoon-work/task-builder-cli` and reads its
verified outputs through `@silvermoon-work/task-builder/car`.

For standalone authoring install `@silvermoon-work/task-builder-cli` and use
`task-builder build <task.build.yaml>`. Install
`@silvermoon-work/task-engine-cli` for execution. Use their upstream documentation
for supported commands; neither is a `pguide` extension.
