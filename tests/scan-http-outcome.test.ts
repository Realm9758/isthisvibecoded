import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyProbeResponse } from '../lib/scan-http-outcome';

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
