/** Resolve the repository's normal devDependency for offline smoke tests.
 * The absolute fallback is only for the isolated artifact-validation container. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const ts = (() => {
  try {
    return require("typescript");
  } catch {
    try {
      return require("/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js");
    } catch {
      try {
        const babel = require("/usr/share/nodejs/@babel/core");
        const tsPlugin = require("/usr/share/nodejs/@babel/plugin-transform-typescript");
        return {
          ModuleKind: { ESNext: 99, CommonJS: 1 },
          ScriptTarget: { ES2022: 9 },
          transpileModule(source, options = {}) {
            const fileName = options.fileName ?? "module.ts";
            const result = babel.transformSync(source, {
              filename: fileName,
              babelrc: false,
              configFile: false,
              retainLines: true,
              plugins: [
                [
                  tsPlugin,
                  {
                    allowDeclareFields: true,
                    onlyRemoveTypeImports: true,
                    isTSX: fileName.endsWith(".tsx")
                  }
                ]
              ]
            });
            return { outputText: result?.code ?? "" };
          }
        };
      } catch {
        throw new Error(
          "Integration smoke requires the TypeScript devDependency: install the locked pnpm workspace first."
        );
      }
    }
  }
})();
