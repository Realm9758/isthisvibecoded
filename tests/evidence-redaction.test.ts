import test from 'node:test';
import assert from 'node:assert/strict';
import { redactEvidenceText } from '../lib/evidence-redaction';

test('evidence redaction removes credential and cookie values', () => {
  const input = [
    `Set-Cookie: session=${'a'.repeat(40)}; HttpOnly`,
    `sk_live_${'b'.repeat(32)}`,
    `AIza${'c'.repeat(35)}`,
    `api_key="${'d'.repeat(30)}"`,
  ].join('\n');
  const output = redactEvidenceText(input);
  for (const secret of ['a'.repeat(40), 'b'.repeat(32), 'c'.repeat(35), 'd'.repeat(30)]) {
    assert.equal(output.includes(secret), false);
  }
});
