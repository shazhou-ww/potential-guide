# Independent text Check

Copy this directory into an independent ESM package. Install the four
dependencies in package.json (local packed tarballs are supported), then run
`node build.mjs` or `pnpm build`. No workspace paths or environment checks are
needed. Entry: `src/main.ts`; contract: `src/contract.ts`;
configuration: `text.check.build.yaml`.

The script calls Check preparation, standard Task build and CAR resource
verification. Output: `dist/staging/text/bundle/` and
`dist/staging/text/bundle.car`, with the CID printed as JSON. Submit input
`{"text":"hello"}` for `{pass:true}`, or `{"text":" "}` for a `text-empty`
problem. The problem code is declared only in YAML. Generated literal types
also support ordinary TypeScript checking after preparation.
