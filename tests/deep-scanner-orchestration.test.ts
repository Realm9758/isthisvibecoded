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
  const transport = async (input: URL | string, init: PinnedFetchInit = {}): Promise<Response> => {
    const url = input instanceof URL ? new URL(input.href) : new URL(input);
    requested.push(`${init.method ?? 'GET'} ${url.href}`);

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
      return new Response('<!doctype html><html><head><title>Fixture</title></head><body>ok</body></html>', {
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
  assert.ok((result.coverage?.requestsAttempted ?? 0) > 100);
  assert.equal(requested[0], 'GET https://fixture.example/app');

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
      return new Response('<!doctype html><html><body>fixture</body></html>', {
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
