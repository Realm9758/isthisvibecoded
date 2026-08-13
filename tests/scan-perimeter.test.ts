import assert from 'node:assert/strict';
import test from 'node:test';

test('ordinary 403 protection does not make the application pass inaccessible', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= `test-service-role-${'x'.repeat(32)}`;
  const { runPerimeterPreflight } = await import('../lib/scan-perimeter');
  let active = 0;
  let maximumActive = 0;
  const result = await runPerimeterPreflight(
    { hostname: 'fixture.example', startUrl: 'https://fixture.example/app' },
    {
      intervalMs: 0,
      transport: async (input: URL | string) => {
        const url = new URL(input.toString());
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setTimeout(resolve, 1));
        active -= 1;
        return url.pathname === '/app'
          ? new Response('ok', { status: 200 })
          : new Response('denied', { status: 403 });
      },
    },
  );
  assert.equal(result.diagnostics.length, 4);
  assert.equal(result.accessReady, true);
  assert.equal(maximumActive, 1);
  assert.equal(result.diagnostics.filter(item => item.classification === 'protected_denial').length, 3);
});

test('a confirmed Cloudflare challenge pauses access with a useful provider diagnosis', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= `test-service-role-${'x'.repeat(32)}`;
  const { runPerimeterPreflight } = await import('../lib/scan-perimeter');
  let requests = 0;
  const result = await runPerimeterPreflight(
    { hostname: 'fixture.example', startUrl: 'https://fixture.example/app' },
    {
      intervalMs: 0,
      transport: async () => {
        requests += 1;
        return new Response('Attention Required | Cloudflare', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge', 'cf-ray': 'abc' },
        });
      },
    },
  );
  assert.equal(result.accessReady, false);
  assert.equal(result.diagnostics[0].classification, 'bot_challenge');
  assert.equal(result.diagnostics[0].provider, 'cloudflare');
  assert.equal(result.diagnostics.length, 1);
  assert.equal(requests, 1, 'a confirmed challenge must stop before later canaries are sent');
});

test('a transient upstream failure is retried once before access continues', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= `test-service-role-${'x'.repeat(32)}`;
  const { runPerimeterPreflight } = await import('../lib/scan-perimeter');
  let requests = 0;
  const retryWaits: number[] = [];
  const result = await runPerimeterPreflight(
    { hostname: 'fixture.example', startUrl: 'https://fixture.example/app' },
    {
      intervalMs: 0,
      retrySleep: async milliseconds => { retryWaits.push(milliseconds); },
      transport: async () => {
        requests += 1;
        return requests === 1
          ? new Response('temporary', { status: 503 })
          : new Response('ok', { status: 200 });
      },
    },
  );
  assert.equal(result.accessReady, true);
  assert.equal(requests, 5);
  assert.deepEqual(retryWaits, [750]);
});

test('a denied submitted page requires an access exception even when denial is ordinary', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= `test-service-role-${'x'.repeat(32)}`;
  const { runPerimeterPreflight } = await import('../lib/scan-perimeter');
  const result = await runPerimeterPreflight(
    { hostname: 'fixture.example', startUrl: 'https://fixture.example/app' },
    { intervalMs: 0, transport: async () => new Response('forbidden', { status: 403 }) },
  );
  assert.equal(result.diagnostics.length, 4);
  assert.equal(result.accessReady, false);
  assert.equal(result.diagnostics[0].classification, 'protected_denial');
});

test('temporary serverless mode never tells an owner to allowlist an unstable address', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= `test-service-role-${'x'.repeat(32)}`;
  const { accessGuide } = await import('../lib/scan-perimeter');
  const guide = accessGuide({
    classification: 'bot_challenge',
    provider: 'cloudflare',
    method: 'GET',
    path: '/app',
    status: 403,
    retryAfterMs: null,
    durationMs: 40,
    message: 'Cloudflare returned a browser challenge',
  }, 'fixture.example', false);
  assert.match(guide.title, /temporary scanner/i);
  assert.ok(guide.steps.some(step => /cannot be safely allowlisted/i.test(step)));
  assert.equal(guide.steps.some(step => /create a cloudflare waf skip rule/i.test(step)), false);
});
