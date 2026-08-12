import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyUnauthenticatedJson } from '../lib/unauthenticated-json';

test('validation schemas are not mistaken for returned credentials', () => {
  assert.equal(classifyUnauthenticatedJson(JSON.stringify({
    password: { required: true, minLength: 8 },
    email: { type: 'string', format: 'email' },
  })), null);
});

test('material secret scalars and multiple account fields remain reviewable', () => {
  assert.equal(classifyUnauthenticatedJson('{"access_token":"real-material-token-value"}'), 'high');
  assert.equal(classifyUnauthenticatedJson('{"email":"person@example.com","user_id":42}'), 'medium');
});

test('error envelopes and placeholders are ignored', () => {
  assert.equal(classifyUnauthenticatedJson('{"error":"unauthorized","status":401}'), null);
  assert.equal(classifyUnauthenticatedJson('{"password":"redacted","access_token":"placeholder"}'), null);
});
