# Vendored shadcn/ui components

Source: [shadcn-ui/ui, tag `shadcn@4.23.0`](https://github.com/shadcn-ui/ui/tree/96da9cc7f1aa10580a3741664e2a77c721206c00),
immutable commit `96da9cc7f1aa10580a3741664e2a77c721206c00` (2026-10-27 release).
`button.tsx`, `dialog.tsx`, `input.tsx`, `sheet.tsx`, `table.tsx`, `tabs.tsx`, and `tooltip.tsx`
are adapted from `apps/v4/registry/new-york-v4/ui/` at that commit.
The upstream MIT license is retained verbatim in `LICENSE` and appended to the
built browser bundle. These are actual React components backed by Radix, not
CSS replicas.

Manual integration adaptations:

- Registry imports become local module imports; no Next.js or registry
  alias package is installed. The upstream `cn` import becomes our small
  `clsx` + `tailwind-merge` helper. The official registry import transformer at
  `packages/registry/src/transformers/transform-import.ts` was inspected.
  TSX references are explicit `.tsx` imports; TypeScript 5.9's
  `rewriteRelativeImportExtensions` emits matching `.js` references. This uses
  the repository checker's supported source mapping without weakening its rules.
- Type-only React imports and repository formatting; `use client` is unnecessary
  in this browser-only build. Close labels are Chinese, with stable `data-close`.
- App sizing, neutral tokens, and overflow rules are local CSS overrides.
  Radix owns dialog focus, dismissal, tabs, and scroll locks.
  v0.6.1 also uses the same pinned upstream Tooltip with the already installed
  Radix package; inline glyphs use the existing Lucide dependency. No dependency
  or CSP policy change is required.
- Runtime dependencies are catalog-pinned: React/React DOM 19.3.1, radix-ui
  1.8.1, lucide-react 0.474.0 (the upstream app's exact icon version),
  class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.7.0.
  Tailwind/CLI 4.3.3 and tw-animate-css 1.4.0 compile local static CSS.
- `get-nonce` 1.0.1 is the real dependency used by `react-style-singleton`.
  The UI sets its nonce before Radix mounts. Each HTML response receives a
  random style-only CSP nonce; scripts remain self-only, style attributes are
  denied, and neither unsafe-inline nor unsafe-eval is enabled.
- The optional Parcel watcher source-build script is explicitly denied.
  The one-shot CSS build uses installed published platform binaries; no extra
  lifecycle script approval, global tool, CDN, font download, or SSR is needed.

React exclusively owns the workbench and the DOM generated from immutable,
detached view descriptions. Descriptions are converted once into React/shadcn
elements and are never attached as live UI. The controller reads uncontrolled
filter values but does not reconcile React DOM. `SchemaIsland` is the sole
exception: React owns only its empty host; `form.ts` exclusively owns its
descendants and retains them across popup unmounts, preserving invalid raw text,
local-reference semantics, and reader identity.
