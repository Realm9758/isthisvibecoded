import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractClientArtifacts,
  extractClientArtifactsFromSources,
  extractNextBuildId,
  extractNextManifestRoutes,
  extractSameOriginScriptUrls,
} from '../lib/client-artifacts';

test('script discovery resolves and deduplicates exact-origin assets', () => {
  const html = `
    <script src="/_next/static/a.js?v=1"></script>
    <script src='/app.js'></script>
    <script src="https://example.com/app.js"></script>
    <script src="https://cdn.example.net/vendor.js"></script>`;
  assert.deepEqual(extractSameOriginScriptUrls(html, 'https://example.com/page'), [
    'https://example.com/_next/static/a.js?v=1',
    'https://example.com/app.js',
  ]);
});

test('client artifacts retain public provider config but not secret values in output text', () => {
  const jwtPayload = Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url');
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${jwtPayload}.${'a'.repeat(32)}`;
  const artifacts = extractClientArtifacts(`
    const url = "https://abcdefghijklmnopqrst.supabase.co";
    const key = "${jwt}";
    supabase.from("profiles");
    supabase.storage.from("public-assets");
    const config = { databaseURL: "https://demo-default-rtdb.firebaseio.com", storageBucket: "demo.firebasestorage.app" };
  `);
  assert.equal(artifacts.supabase?.keyKind, 'legacy-anon');
  assert.deepEqual(artifacts.supabase?.tables, ['profiles']);
  assert.deepEqual(artifacts.supabase?.storageBuckets, ['public-assets']);
  assert.equal(artifacts.firebase?.storageBucket, 'demo.firebasestorage.app');
});

test('provider configuration can be correlated across separate browser assets', () => {
  const artifacts = extractClientArtifactsFromSources([
    'window.projectUrl = "https://abcdefghijklmnopqrst.supabase.co";',
    `window.publicKey = "sb_publishable_${'p'.repeat(32)}";`,
    'client.from("private_profiles");',
  ]);

  assert.equal(artifacts.supabase?.url, 'https://abcdefghijklmnopqrst.supabase.co');
  assert.equal(artifacts.supabase?.keyKind, 'publishable');
  assert.deepEqual(artifacts.supabase?.tables, ['private_profiles']);
});

test('Next.js discovery accepts structured build ids and concrete manifest routes only', () => {
  const html = '<script id="__NEXT_DATA__" type="application/json">{"buildId":"build_123"}</script>';
  assert.equal(extractNextBuildId(html), 'build_123');
  assert.equal(extractNextBuildId('<script>const buildId="made-up"</script>'), null);
  assert.deepEqual(
    extractNextManifestRoutes('self.__BUILD_MANIFEST={sortedPages:["/","/dashboard","/[user]","/_next/data"]}'),
    ['/', '/dashboard'],
  );
});
