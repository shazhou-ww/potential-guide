# Requirements-led monorepo checks

Private reusable workspace for the [pnpm monorepo Objective](../../objectives/pnpm-monorepo/README.md).
This is not a new public npm release and does not change the existing public API.

```ts
import { checkMonorepo, contractSchema, parseContract } from "@potential-guide/monorepo-objective";

const report = await checkMonorepo(absoluteTargetRoot, "requirements.json");
```

`contractSchema` is the strict version-1 JSON schema. `parseContract` validates
unknown input; `checkMonorepo(root, path, 1)` observes only structure, while the
default checks deliveries only after structure is established. Reports are JSON
data with four-state findings, not architecture scores or automatic repair plans.
The observer never spawns processes, installs dependencies or writes target files.
See the Objective guide for supported schemas, limitations and independent proof.
