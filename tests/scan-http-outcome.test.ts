import assert from 'node:assert/strict';
import test from 'node:test';
import { assessProbeResponse, classifyProbeResponse, retryAfterMilliseconds } from '../lib/scan-http-outcome';

test('ordinary negative HTTP responses remain usable evidence', () => {
  assert.equal(classifyProbeResponse(401, new Headers()), 'completed');
  assert.equal(classifyProbeResponse(403, new Headers()), 'completed');
  assert.equal(classifyProbeResponse(404, new Headers()), 'completed');
});

test('rate limits and explicit bot challenges are coverage gaps', () => {
  assert.equal(classifyProbeResponse(429, new Headers()), 'blocked');
  assert.equal(classifyProbeResponse(403, new Headers({ 'cf-mitigated': 'challenge' })), 'blocked');
  assert.equal(classifyProbeResponse(403, new Headers({ 'x-vercel-mitigated': 'challenge' })), 'blocked');
  assert.equal(
    classifyProbeResponse(403, new Headers(), { forbiddenIsBlocked: true }),
    'blocked',
    'active payload checks can distinguish an unevaluated denial from an ordinary auth check',
  );
});

test('a 429 is usable only when rate limiting is the evidence being measured', () => {
  assert.equal(classifyProbeResponse(429, new Headers(), { rateLimitIsEvidence: true }), 'completed');
  assert.equal(classifyProbeResponse(429, new Headers({ 'cf-mitigated': 'challenge' }), { rateLimitIsEvidence: true }), 'blocked');
});

test('server and upstream failures are not clean probe results', () => {
  assert.equal(classifyProbeResponse(500, new Headers()), 'failed');
  assert.equal(classifyProbeResponse(502, new Headers()), 'failed');
  assert.equal(classifyProbeResponse(503, new Headers()), 'failed');
});

test('diagnostics retain the provider and a bounded Retry-After value', () => {
  const cloudflare = assessProbeResponse(
    403,
    new Headers({ 'cf-mitigated': 'challenge', 'cf-ray': 'abc' }),
  );
  assert.equal(cloudflare.classification, 'bot_challenge');
  assert.equal(cloudflare.provider, 'cloudflare');

  assert.equal(retryAfterMilliseconds('12', 0), 12_000);
  assert.equal(retryAfterMilliseconds('999', 0), 120_000);
  assert.equal(retryAfterMilliseconds('not-a-date', 0), null);
});

test('ordinary authorization denials are explicit usable protection evidence', () => {
  const assessment = assessProbeResponse(403, new Headers());
  assert.equal(assessment.outcome, 'completed');
  assert.equal(assessment.classification, 'protected_denial');
  assert.match(assessment.message, /usable protection evidence/);
});
