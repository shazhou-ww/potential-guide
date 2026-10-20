import type { ResolveHook } from "node:module";

export const resolve: ResolveHook = (specifier, context, nextResolve) =>
  specifier === "@potential-guide/objective-pilot"
    ? { url: new URL("./index.js", import.meta.url).href, shortCircuit: true }
    : nextResolve(specifier, context);
