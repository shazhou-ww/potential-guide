# Define levels as attained stages with independent checks

## Problem

Levels currently group checks that execute in list order and stop at the first
failure. This makes checks within a level implicitly dependent on earlier checks,
rather than independently applicable at an attained stage.

## Outcome

A level represents an attained stage and is the sole stage prerequisite for every
check attached to it. Checks within that level are independently eligible;
scheduling concurrency or policy, not their membership or list position,
determines whether they actually execute concurrently.

## Boundaries

- Preserve ordered stage advancement: all checks attached to a stage must pass
  before the next stage is attained; unmet guide prerequisites still block entry.
- A check must not depend on another check in the same level completing or
  passing. Scheduling may serialize execution without creating such a dependency.
- Keep execution policy separate from the level definition; this change does not
  introduce arbitrary check dependency graphs or portfolio scheduling.

## Acceptance criteria

- Every check in the current attained stage remains eligible even if a peer
  reports failure, and observations include failures from that stage without
  relying on completion order.
- Checks within a stage can overlap when scheduling permits; limiting concurrency
  to one changes execution timing only, not eligibility or advancement.
- Subsequent stages remain blocked until all current-stage checks pass, and
  prerequisite and terminal observations retain their existing meanings.
