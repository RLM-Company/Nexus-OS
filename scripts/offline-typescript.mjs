/** Resolve the repository's normal devDependency for offline smoke tests.
 * The absolute fallback is only for the isolated artifact-validation container. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const ts = (() => {
  try { return require('typescript'); }
  catch {
    try { return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js'); }
    catch { throw new Error('Integration smoke requires the TypeScript devDependency: install the locked pnpm workspace first.'); }
  }
})();
