import assert from 'node:assert/strict';
import test from 'node:test';
import type { PinnedFetchInit } from '../lib/pinned-fetch';
import type { ScanPhaseProgress } from '../types/deep-scan';

test('a deep scan accounts for every advertised phase without silent skips', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= `test-service-role-${'x'.repeat(32)}`;

  const [{ deepScanDomain }, { SCAN_PHASES }] = await Promise.all([
    import('../lib/deep-scanner'),
    import('../lib/scan-phases'),
  ]);

  const requested: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const transport = async (input: URL | string, init: PinnedFetchInit = {}): Promise<Response> => {
    const url = input instanceof URL ? new URL(input.href) : new URL(input);
    requested.push(`${init.method ?? 'GET'} ${url.href}`);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, 1));
    inFlight -= 1;

    if (url.protocol === 'http:' && url.pathname === '/' && !url.search) {
      return new Response(null, {
        status: 301,
        headers: { location: `https://${url.hostname}/` },
      });
    }
    if (
      url.protocol === 'https:'
      && url.pathname === '/app'
      && !url.search
      && (init.method ?? 'GET') === 'GET'
    ) {
      return new Response(`<!doctype html><html><head><title>Fixture</title></head><body>
        <form action="search" method="get"><input name="q"><input name="redirect"><input name="url"><input name="file"></form>
        <form action="/session" method="post"><input type="email" name="email"><input type="password" name="password"></form>
        <a href="/api/users?id=1">users</a>
      </body></html>`, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'self'",
          'strict-transport-security': 'max-age=31536000; includeSubDomains',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'permissions-policy': 'camera=(), microphone=()',
        },
      });
    }
    if (url.protocol === 'https:' && url.pathname === '/' && !url.search) {
      return new Response('<!doctype html><html><body>root fixture</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  };

  const events: Array<{ id: string; progress: ScanPhaseProgress }> = [];
  const result = await deepScanDomain(
    { hostname: 'fixture.example', startUrl: 'https://fixture.example/app' },
    'deep',
    (phase, _findings, progress) => events.push({ id: phase.id, progress }),
    { transport },
  );

  const terminal = events.filter(event =>
    ['complete', 'incomplete', 'not_applicable'].includes(event.progress.status)
  );
  assert.deepEqual(terminal.map(event => event.id), SCAN_PHASES.map(phase => phase.id));
  assert.equal(result.coverage?.checks?.length, 31);
  assert.equal(result.checked.length, 31);
  assert.equal(new Set(result.checked.map(item => item.id)).size, 31);
  assert.equal(result.coverage?.checks?.some(check => !check.complete), false);
  assert.equal(result.coverage?.checks?.every(check => typeof check.durationMs === 'number' && check.durationMs >= 0), true);
  assert.ok((result.coverage?.requestsAttempted ?? 0) > 100);
  assert.ok(maxInFlight > 1, 'independent probes should overlap instead of being serialized');
  assert.equal(requested[0], 'GET https://fixture.example/app');
  assert.equal(result.application?.pageUrl, 'https://fixture.example/app');
  assert.equal(result.application?.formsDiscovered, 2);
  assert.equal(result.application?.loginFormsDiscovered, 1);
  assert.ok((result.application?.publicGetParametersDiscovered ?? 0) >= 5);

  const requestProgress = events.filter(event => event.progress.status === 'progress');
  assert.ok(requestProgress.length > 0);
  assert.ok(requestProgress.some(event => (event.progress.coverage?.requestsAttempted ?? 0) > 0));

  const deferredDoneEvents: ScanPhaseProgress[] = [];
  await deepScanDomain(
    { hostname: 'fixture.example', startUrl: 'https://fixture.example/app' },
    'deep',
    (phase, _findings, progress) => {
      if (phase.id === 'done') deferredDoneEvents.push(progress);
    },
    { transport, deferDoneCompletion: true },
  );
  assert.deepEqual(
    deferredDoneEvents.map(progress => progress.status),
    ['start'],
    'the API route owns the final completion event when persistence is included in that step',
  );
});

test('blanket active-probe denials are inconclusive and cannot produce a flattering grade', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= `test-service-role-${'x'.repeat(32)}`;
  const { deepScanDomain } = await import('../lib/deep-scanner');

  const transport = async (input: URL | string, init: PinnedFetchInit = {}): Promise<Response> => {
    const url = input instanceof URL ? new URL(input.href) : new URL(input);
    if (
      url.href === 'https://fixture.example/app'
      && (init.method ?? 'GET') === 'GET'
      && !new Headers(init.headers).has('host')
    ) {
      return new Response(`<!doctype html><html><body>
        <form action="/search" method="get">
          <input name="q"><input name="redirect"><input name="url"><input name="file"><input name="name">
        </form>
        <a href="/api/search?id=1">API search</a>
      </body></html>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response('request denied', {
      status: 403,
      headers: { 'content-type': 'text/plain' },
    });
  };

  const terminal = new Map<string, ScanPhaseProgress>();
  const result = await deepScanDomain(
    { hostname: 'fixture.example', startUrl: 'https://fixture.example/app' },
    'deep',
    (phase, _findings, progress) => {
      if (['complete', 'incomplete', 'not_applicable'].includes(progress.status)) {
        terminal.set(phase.id, progress);
      }
    },
    { transport },
  );

  for (const phaseId of ['xss', 'sqli', 'ssrf', 'traversal', 'nosql', 'hostheader', 'crlf']) {
    assert.equal(terminal.get(phaseId)?.status, 'incomplete', phaseId);
    const coverage = result.coverage?.checks?.find(check => check.phaseId === phaseId);
    assert.equal(coverage?.complete, false, phaseId);
    assert.ok((coverage?.requestsBlocked ?? 0) > 0, phaseId);
  }
  assert.equal(result.summary.score, null);
});

test('a redirect away from the verified host is a bounded negative response, not a blocked request', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= `test-service-role-${'x'.repeat(32)}`;
  const { deepScanDomain } = await import('../lib/deep-scanner');

  const transport = async (input: URL | string, init: PinnedFetchInit = {}): Promise<Response> => {
    const url = input instanceof URL ? new URL(input.href) : new URL(input);
    if (url.href === 'https://fixture.example/app' && (init.method ?? 'GET') === 'GET') {
      return new Response('<!doctype html><html><body>fixture</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { location: 'https://login.example.net/sign-in' },
    });
  };

  const result = await deepScanDomain(
    { hostname: 'fixture.example', startUrl: 'https://fixture.example/app' },
    'deep',
    undefined,
    { transport },
  );
  assert.equal(result.coverage?.requestsBlocked, 0);
  assert.equal(result.coverage?.checks?.some(check => !check.complete), false);
});
