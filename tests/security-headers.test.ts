import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSecurityHeaders } from '../lib/security-headers';

const VALID_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

test('a complete valid header set receives the full hardening index', () => {
  const result = analyzeSecurityHeaders(VALID_HEADERS, true);
  assert.equal(result.score, 100);
  assert.ok(result.headers.every(header => header.valid));
});

test('header presence without an effective value receives no credit', () => {
  const result = analyzeSecurityHeaders({
    'content-security-policy': 'upgrade-insecure-requests',
    'strict-transport-security': 'max-age=0',
    'x-frame-options': 'ALLOW-FROM https://example.com',
    'x-content-type-options': 'on',
    'referrer-policy': 'unsafe-url',
    'permissions-policy': 'not a policy',
  }, true);

  assert.equal(result.score, 25);
  assert.ok(result.headers.every(header => header.present && header.valid === false));
});

test('CSP frame-ancestors is accepted instead of the legacy frame header', () => {
  const headers = { ...VALID_HEADERS };
  delete headers['x-frame-options'];
  const result = analyzeSecurityHeaders(headers, true);
  const frameHeader = result.headers.find(header => header.name === 'X-Frame-Options');

  assert.equal(result.score, 100);
  assert.equal(frameHeader?.present, true);
  assert.equal(frameHeader?.valid, true);
  assert.match(frameHeader?.value ?? '', /frame-ancestors/);
});

test('weak-but-active CSP and HSTS values receive partial credit', () => {
  const result = analyzeSecurityHeaders({
    ...VALID_HEADERS,
    'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-eval'",
    'strict-transport-security': 'max-age=86400',
  }, true);

  assert.equal(result.score, 77);
  assert.equal(
    result.headers.find(header => header.name === 'Content-Security-Policy')?.penaltyApplied,
    13,
  );
  assert.equal(
    result.headers.find(header => header.name === 'Strict-Transport-Security')?.penaltyApplied,
    10,
  );
});

test('wildcard CSP directives earn no script or clickjacking credit', () => {
  const headers = { ...VALID_HEADERS };
  delete headers['x-frame-options'];
  headers['content-security-policy'] = 'default-src *; frame-ancestors *';

  const result = analyzeSecurityHeaders(headers, true);
  const csp = result.headers.find(header => header.name === 'Content-Security-Policy');
  const frame = result.headers.find(header => header.name === 'X-Frame-Options');

  assert.equal(result.score, 70);
  assert.equal(csp?.valid, false);
  assert.equal(csp?.penaltyApplied, 25);
  assert.equal(frame?.present, false);
  assert.equal(frame?.penaltyApplied, 5);
});

test('broad script URL schemes do not receive full CSP credit', () => {
  for (const source of ['https:', 'http:', 'data:']) {
    const result = analyzeSecurityHeaders({
      ...VALID_HEADERS,
      'content-security-policy': `default-src 'self'; script-src 'self' ${source}`,
    }, true);
    const csp = result.headers.find(header => header.name === 'Content-Security-Policy');
    assert.equal(csp?.valid, false);
    assert.equal(csp?.penaltyApplied, 19);
    assert.match(csp?.details ?? '', /broad URL scheme/);
  }
});

test('a nonce on a different CSP directive does not excuse unsafe inline scripts', () => {
  const result = analyzeSecurityHeaders({
    ...VALID_HEADERS,
    'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'nonce-style123'",
  }, true);

  const csp = result.headers.find(header => header.name === 'Content-Security-Policy');
  assert.equal(result.score, 94);
  assert.equal(csp?.valid, false);
  assert.equal(csp?.penaltyApplied, 6);
});

test('an unrestricted Permissions-Policy does not receive hardening credit', () => {
  const result = analyzeSecurityHeaders({
    ...VALID_HEADERS,
    'permissions-policy': 'camera=*',
  }, true);

  const policy = result.headers.find(header => header.name === 'Permissions-Policy');
  assert.equal(result.score, 95);
  assert.equal(policy?.valid, false);
  assert.equal(policy?.penaltyApplied, 5);
});
