import assert from 'node:assert/strict';
import test from 'node:test';
import { assessSriTag } from '../lib/subresource-integrity';

const PAGE = 'https://app.example/page';
const HASH = `sha384-${'A'.repeat(64)}`;

test('SRI assessment distinguishes missing, invalid, and incomplete attributes', () => {
  assert.equal(
    assessSriTag('<script src="https://cdn.example/pkg@1.2.3/app.js"></script>', PAGE)?.issue,
    'missing_integrity',
  );
  assert.equal(
    assessSriTag('<script src="https://cdn.example/pkg@1.2.3/app.js" integrity=""></script>', PAGE)?.issue,
    'invalid_integrity',
  );
  assert.equal(
    assessSriTag(`<script src="https://cdn.example/pkg@1.2.3/app.js" integrity="${HASH}"></script>`, PAGE)?.issue,
    'missing_crossorigin',
  );
  assert.equal(
    assessSriTag(`<script src="https://cdn.example/pkg@1.2.3/app.js" integrity="${HASH}" crossorigin="anonymous"></script>`, PAGE),
    null,
  );
});

test('same-origin and moving third-party resources abstain', () => {
  assert.equal(assessSriTag('<script src="/app.123.js"></script>', PAGE), null);
  assert.equal(assessSriTag('<script src="https://cdn.example/latest.js"></script>', PAGE), null);
});
