import assert from 'node:assert/strict';
import test from 'node:test';
import { assessRateLimitEvidence, describeRateLimitEvidence, normalizeOwnerRateLimitPath, selectRateLimitTarget } from '../lib/rate-limit-evidence';

test('owner-selected rate-limit paths are read-only and contain no durable query values', () => {
  assert.equal(normalizeOwnerRateLimitPath('/api/search'), '/api/search');
  assert.equal(normalizeOwnerRateLimitPath(''), null);
  assert.throws(() => normalizeOwnerRateLimitPath('/api/search?q=private'), /Remove query values/);
  assert.throws(() => normalizeOwnerRateLimitPath('/api/logout'), /read-only endpoint/);
  assert.throws(() => normalizeOwnerRateLimitPath('//other.example/api/search'), /relative public path/);
  assert.throws(() => normalizeOwnerRateLimitPath('/api/%6c%6f%67%6f%75%74'), /read-only endpoint/);
});

test('rate-limit target prefers a discovered GET query and refuses state-changing routes', () => {
  const selected = selectRateLimitTarget(
    'https://example.com',
    [{ url: 'https://example.com/api/search', parameter: 'q', kind: 'search', source: 'form' }],
    ['/api/logout', '/api/users'],
    [],
  );
  assert.equal(selected, 'https://example.com/api/search?q=ironclad-rate-control');

  assert.equal(selectRateLimitTarget('https://example.com', [], ['/api/logout'], []), null);
  assert.equal(selectRateLimitTarget('https://example.com', [], ['/api/users'], ['https://example.com/api/users']), null);
});

test('rate-limit evidence distinguishes enforcement, advertised policy and no signal', () => {
  const enforced = assessRateLimitEvidence([
    new Response(null, { status: 200 }),
    new Response(null, { status: 429, headers: { 'retry-after': '30' } }),
  ]);
  assert.deepEqual(enforced, { throttled: true, headerNames: ['retry-after'] });
  assert.match(describeRateLimitEvidence(enforced, 6), /confirms a low-volume throttle/);

  const advertised = assessRateLimitEvidence([
    new Response(null, { status: 200, headers: { 'ratelimit-limit': '100' } }),
  ]);
  assert.deepEqual(advertised, { throttled: false, headerNames: ['ratelimit-limit'] });
  assert.match(describeRateLimitEvidence(advertised, 6), /advertised rate-limit policy/);

  assert.match(describeRateLimitEvidence({ throttled: false, headerNames: [] }, 6), /does not cover login attempts/);
});
