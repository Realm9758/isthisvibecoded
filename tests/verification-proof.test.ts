import test from 'node:test';
import assert from 'node:assert/strict';
import { hasVerificationMetaInHead } from '../lib/verification-proof';

const TOKEN = 'abc123-control-token';

test('meta verification requires a genuine tag in the document head', () => {
  assert.equal(hasVerificationMetaInHead(
    `<html><head><meta content="${TOKEN}" name="vibecoded-verification"></head><body></body></html>`,
    TOKEN,
  ), true);
  assert.equal(hasVerificationMetaInHead(
    `<html><head><!-- <meta name="vibecoded-verification" content="${TOKEN}"> --></head></html>`,
    TOKEN,
  ), false);
  assert.equal(hasVerificationMetaInHead(
    `<html><head><script>const x='<meta name="vibecoded-verification" content="${TOKEN}">'</script></head></html>`,
    TOKEN,
  ), false);
  assert.equal(hasVerificationMetaInHead(
    `<html><head></head><body><meta name="vibecoded-verification" content="${TOKEN}"></body></html>`,
    TOKEN,
  ), false);
});
