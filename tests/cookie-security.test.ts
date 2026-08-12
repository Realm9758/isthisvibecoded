import assert from 'node:assert/strict';
import test from 'node:test';
import { assessSetCookie } from '../lib/cookie-security';

test('recognises common framework authentication cookie names', () => {
  for (const name of [
    'next-auth.session-token',
    'authjs.session-token',
    '.AspNetCore.Cookies',
    '__session',
    '__Host-session',
  ]) {
    assert.equal(assessSetCookie(`${name}=redacted; Secure; SameSite=Lax`)?.isAuth, true, name);
  }
});

test('validates SameSite values instead of accepting any attribute value', () => {
  assert.deepEqual(
    assessSetCookie('session=redacted; HttpOnly; Secure; SameSite=Eventually')?.issues,
    ['invalid_samesite'],
  );
  assert.deepEqual(
    assessSetCookie('session=redacted; HttpOnly; SameSite=None')?.issues,
    ['missing_secure', 'samesite_none_without_secure'],
  );
});

test('enforces cookie prefix rules', () => {
  assert.deepEqual(
    assessSetCookie('__Host-session=redacted; HttpOnly; Secure; Path=/; SameSite=Strict')?.issues,
    [],
  );
  assert.ok(
    assessSetCookie('__Host-session=redacted; HttpOnly; Secure; Path=/app; SameSite=Strict')
      ?.issues.includes('invalid_host_prefix'),
  );
  assert.ok(
    assessSetCookie('__Secure-session=redacted; HttpOnly; SameSite=Lax')
      ?.issues.includes('invalid_secure_prefix'),
  );
});

test('rejects malformed Set-Cookie lines', () => {
  assert.equal(assessSetCookie('not-a-cookie'), null);
  assert.equal(assessSetCookie('=missing-name; Secure'), null);
});
