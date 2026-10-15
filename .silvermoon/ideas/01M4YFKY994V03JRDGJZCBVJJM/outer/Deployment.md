# Deployment

## Steps

### D-S01: Verify the primary candidate as a consumer

Verify the implementation accepted on primary through a consumer-level guide
using independent checks and contrasting scheduling limits. No npm publication
or production rollout is assumed.

## Acceptance criteria

### D-AC01: Primary exposes the accepted stage behavior

A reproducible consumer exercise against the accepted primary revision shows
that serial and concurrent scheduling produce the same stage and problems,
while later stages remain blocked by current-stage failures. Record the primary
revision and exercise evidence in this contract during deployment.
