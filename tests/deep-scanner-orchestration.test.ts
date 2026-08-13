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
  assert.equal(result.coverage?.checks?.length, 32);
  assert.equal(result.checked.length, 32);
  assert.equal(new Set(result.checked.map(item => item.id)).size, 32);
  assert.equal(result.coverage?.checks?.some(check => !check.complete), false);
  assert.equal(result.coverage?.checks?.every(check => typeof check.durationMs === 'number' && check.durationMs >= 0), true);
  assert.ok((result.coverage?.requestsAttempted ?? 0) > 100);
  assert.equal(maxInFlight, 1, 'all target probes must be serialized even when modules create concurrent tasks');
  assert.equal(requested[0], 'GET https://fixture.example/app');
  assert.equal(result.application?.pageUrl, 'https://fixture.example/app');
  assert.equal(result.application?.formsDiscovered, 2);
  assert.equal(result.application?.loginFormsDiscovered, 1);
  assert.ok((result.application?.publicGetParametersDiscovered ?? 0) >= 5);

  const requestProgress = events.filter(event => event.progress.status === 'progress');
  assert.ok(requestProgress.length > 0);
  assert.ok(requestProgress.some(event => (event.progress.coverage?.requestsAttempted ?? 0) > 0));
  assert.ok(requestProgress.some(event => (event.progress.completedProbes ?? 0) > 0));

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

test('a custom scope executes and persists only the backend-selected modules', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= `test-service-role-${'x'.repeat(32)}`;
  const { deepScanDomain } = await import('../lib/deep-scanner');

  const transport = async (input: URL | string): Promise<Response> => {
    const url = input instanceof URL ? new URL(input.href) : new URL(input);
    if (url.protocol === 'http:') {
      return new Response(null, { status: 301, headers: { location: `https://${url.hostname}/` } });
    }
    return new Response('<!doctype html><html><body>scoped fixture</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html', 'strict-transport-security': 'max-age=31536000' },
    });
  };
  const terminal: string[] = [];
  const result = await deepScanDomain(
    { hostname: 'fixture.example', startUrl: 'https://fixture.example/app' },
    'deep',
    (phase, _findings, progress) => {
      if (['complete', 'incomplete', 'not_applicable'].includes(progress.status)) terminal.push(phase.id);
    },
    { transport, selectedPhaseIds: ['ssl', 'headers'] },
  );

  assert.deepEqual(terminal, ['init', 'headers', 'ssl', 'done']);
  assert.deepEqual(result.scope, { phaseIds: ['headers', 'ssl'], fullInventory: false });
  assert.deepEqual(result.coverage?.checks?.map(check => check.phaseId), ['headers', 'ssl']);
  assert.deepEqual(result.checked.map(item => item.id), ['ssl', 'headers']);
  assert.equal(result.summary.score, null);
});

test('a recovered worker reuses terminal module outcomes without sending those probes again', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= `test-service-role-${'x'.repeat(32)}`;
  const { deepScanDomain } = await import('../lib/deep-scanner');
  let requests = 0;
  const transport = async (input: URL | string): Promise<Response> => {
    requests += 1;
    const url = new URL(input.toString());
    if (url.protocol === 'http:') {
      return new Response(null, { status: 301, headers: { location: `https://${url.hostname}/` } });
    }
    return new Response('<!doctype html><html><body>recovery fixture</body></html>', {
      status: 200,
      headers: {
        'content-type': 'text/html',
        'content-security-policy': "default-src 'self'",
        'strict-transport-security': 'max-age=31536000',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin',
        'permissions-policy': 'camera=()',
      },
    });
  };
  const first = await deepScanDomain(
    { hostname: 'fixture.example', startUrl: 'https://fixture.example/app' },
    'deep', undefined, { transport, selectedPhaseIds: ['headers', 'ssl'] },
  );
  const resumePhases = (first.coverage?.checks ?? []).map(coverage => ({
    phaseId: coverage.phaseId,
    findings: [],
    coverage,
    transportAttempts: coverage.requestsAttempted,
    retries: 0,
  }));
  requests = 0;
  const phaseEvents: string[] = [];
  const recovered = await deepScanDomain(
    { hostname: 'fixture.example', startUrl: 'https://fixture.example/app' },
    'deep',
    (phase, _findings, progress) => {
      if (progress.status === 'start') phaseEvents.push(phase.id);
    },
    { transport, selectedPhaseIds: ['headers', 'ssl'], resumePhases },
  );
  assert.equal(requests, 1, 'only the submitted page is refreshed before recovered modules are reused');
  assert.deepEqual(phaseEvents, ['init', 'done']);
  assert.deepEqual(recovered.coverage?.checks?.map(item => item.phaseId), ['headers', 'ssl']);
  assert.equal(recovered.checked.length, 2);
});

test('rate-limit scope uses a discovered safe GET route and records bounded throttle evidence', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= `test-service-role-${'x'.repeat(32)}`;
  const { deepScanDomain } = await import('../lib/deep-scanner');
  let apiRequests = 0;

  const transport = async (input: URL | string): Promise<Response> => {
    const url = input instanceof URL ? new URL(input.href) : new URL(input);
    if (url.pathname === '/app') {
      return new Response('<!doctype html><html><body><a href="/api/search?q=hello">search</a></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (url.pathname === '/api/search') {
      apiRequests += 1;
      return apiRequests >= 4
        ? new Response('slow down', { status: 429, headers: { 'retry-after': '10' } })
        : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  };

  const result = await deepScanDomain(
    { hostname: 'fixture.example', startUrl: 'https://fixture.example/app' },
    'deep',
    undefined,
    { transport, selectedPhaseIds: ['ratelimit'] },
  );

  assert.equal(apiRequests, 6);
  assert.deepEqual(result.coverage?.checks?.map(check => check.phaseId), ['vibe', 'ratelimit']);
  const rateCoverage = result.coverage?.checks?.find(check => check.phaseId === 'ratelimit');
  assert.equal(rateCoverage?.complete, true);
  assert.equal(rateCoverage?.requestsAttempted, 6);
  const rateItem = result.checked.find(item => item.id === 'ratelimit');
  assert.equal(rateItem?.status, 'observe');
  assert.match(rateItem?.detail ?? '', /confirms a low-volume throttle/);
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

test('a confirmed bot challenge stops queued module probes before they reach the target', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= `test-service-role-${'x'.repeat(32)}`;
  const { deepScanDomain } = await import('../lib/deep-scanner');
  const requests: string[] = [];
  const transport = async (input: URL | string): Promise<Response> => {
    const url = new URL(input.toString());
    requests.push(url.pathname);
    if (url.pathname === '/app') {
      return new Response('<!doctype html><html><body>fixture</body></html>', {
        status: 200, headers: { 'content-type': 'text/html' },
      });
    }
    return new Response('Attention Required | Cloudflare', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge', 'cf-ray': 'fixture' },
    });
  };
  await assert.rejects(
    deepScanDomain(
      { hostname: 'fixture.example', startUrl: 'https://fixture.example/app' },
      'deep', undefined, { transport, selectedPhaseIds: ['files'] },
    ),
    (error: unknown) => error instanceof Error && error.name === 'ScanAccessPausedError',
  );
  assert.deepEqual(requests, ['/app', '/.env']);
});

test('a catch-all application shell is not mistaken for files, admin tools, listings, docs, APIs, or diagnostics', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= `test-service-role-${'x'.repeat(32)}`;
  const { deepScanDomain } = await import('../lib/deep-scanner');
  const shell = '<!doctype html><html><head><title>Product</title></head><body><main>Welcome to the product</main></body></html>';
  const transport = async (input: URL | string): Promise<Response> => {
    const url = new URL(input.toString());
    if (url.protocol === 'http:') {
      return new Response(null, { status: 301, headers: { location: `https://${url.hostname}${url.pathname}` } });
    }
    return new Response(shell, {
      status: 200,
      headers: {
        'content-type': 'text/html',
        'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
        'strict-transport-security': 'max-age=31536000',
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin',
        'permissions-policy': 'camera=()',
      },
    });
  };
  const result = await deepScanDomain(
    { hostname: 'fixture.example', startUrl: 'https://fixture.example/app' },
    'deep', undefined,
    { transport, selectedPhaseIds: ['files', 'admin', 'dirlist', 'serverstatus', 'forced', 'graphql', 'apidocs'] },
  );
  const forbiddenPrefixes = ['exposed-', 'admin-', 'directory-', 'diagnostic-', 'auth-unprotected', 'graphql-', 'api-docs-'];
  assert.deepEqual(
    result.findings.filter(finding => forbiddenPrefixes.some(prefix => finding.id.startsWith(prefix))),
    [],
  );
  assert.equal(result.coverage?.checks?.every(check => check.complete), true);
});
