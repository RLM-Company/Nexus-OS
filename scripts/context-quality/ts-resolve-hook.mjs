/** Node 24 resolution hook for running workspace TypeScript directly.
 *
 * - remaps emitted ".js" specifiers to their ".ts" sources inside workspace packages;
 * - resolves @cosmora/contracts (and its subpaths) to workspace source, so
 *   --experimental-strip-types applies (files reached through node_modules are
 *   not stripped by Node).
 *
 * Used only by the local context-quality benchmark; production builds unchanged.
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const contractsSrc = fileURLToPath(new URL("../../packages/contracts/src/", import.meta.url));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@cosmora/contracts" || specifier.startsWith("@cosmora/contracts/")) {
      const sub = specifier.slice("@cosmora/contracts".length);
      let rel = sub ? sub.replace(/^\//, "") : "index.ts";
      if (!rel.endsWith(".ts")) rel = rel.replace(/\.js$/, "") + ".ts";
      return {
        url: pathToFileURL(contractsSrc + rel).href,
        shortCircuit: true
      };
    }
    if (
      specifier.startsWith("./") &&
      specifier.endsWith(".js") &&
      /\/packages\/(core|contracts)\/src\//.test(context.parentURL ?? "")
    ) {
      return nextResolve(specifier.replace(/\.js$/, ".ts"), context);
    }
    return nextResolve(specifier, context);
  }
});
