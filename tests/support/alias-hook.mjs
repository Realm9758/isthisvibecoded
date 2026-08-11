/**
 * Resolves the `@/` path alias for the compiled test suite.
 *
 * tsc type-checks `@/lib/x` against tsconfig `paths` but deliberately does not
 * rewrite the specifier on emit, so the JavaScript in .test-dist still asks for
 * a module Node cannot find. Any lib module with a runtime `@/` import
 * therefore fails to load, taking its whole test file with it, which is why
 * tests/deep-score.test.ts could not run at all.
 *
 * `server-only` is stubbed for the same reason: it exists to throw when pulled
 * into a client bundle, and a Node test runner is neither a client bundle nor
 * a place that check can succeed.
 */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const DIST_ROOT = path.resolve(import.meta.dirname, '..', '..', '.test-dist');
const SERVER_ONLY_STUB = pathToFileURL(
  path.join(import.meta.dirname, 'server-only-stub.cjs'),
).href;

function resolveAlias(specifier) {
  const base = path.join(DIST_ROOT, specifier.slice(2));
  const candidates = [`${base}.js`, path.join(base, 'index.js'), base];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: SERVER_ONLY_STUB, shortCircuit: true };
    }
    if (specifier.startsWith('@/')) {
      const url = resolveAlias(specifier);
      if (url) return { url, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
