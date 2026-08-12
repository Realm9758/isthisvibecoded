import test from 'node:test';
import assert from 'node:assert/strict';
import { mutationRequestError, readBoundedJson } from '../lib/request-security';
import { MUTATION_GUARD_HEADER, MUTATION_GUARD_VALUE } from '../lib/request-security-constants';
import { SITE_ORIGIN } from '../lib/site';

function guardedRequest(body: string, origin = new URL(SITE_ORIGIN).origin): Request {
  return new Request(`${SITE_ORIGIN}/api/deep-scan`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      [MUTATION_GUARD_HEADER]: MUTATION_GUARD_VALUE,
    },
    body,
  });
}

test('mutation guard requires the exact application origin and custom header', () => {
  assert.equal(mutationRequestError(guardedRequest('{}')), null);
  assert.match(mutationRequestError(guardedRequest('{}', 'https://attacker.example')) ?? '', /Ironclad application/);
  const missingHeader = new Request(`${SITE_ORIGIN}/api/deep-scan`, {
    method: 'POST',
    headers: { Origin: new URL(SITE_ORIGIN).origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.match(mutationRequestError(missingHeader) ?? '', /verification header/);
});

test('JSON reads enforce the real byte length', async () => {
  const oversized = guardedRequest(JSON.stringify({ value: 'x'.repeat(17_000) }));
  await assert.rejects(readBoundedJson(oversized), /too large/);
  assert.deepEqual(await readBoundedJson(guardedRequest('{"ok":true}')), { ok: true });
});
